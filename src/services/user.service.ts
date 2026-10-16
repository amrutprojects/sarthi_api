import bcrypt from 'bcrypt';
import type { Request } from 'express';
import { In, type EntityManager } from 'typeorm';
import { AppDataSource } from '../config/database.config';
import { appConfig } from '../config/app.config';
import { AUDIT_ACTIONS } from '../constants/app.constants';
import { ROLE_CODES } from '../constants/role.constants';
import { UserRole } from '../entities/user-role.entity';
import type { User } from '../entities/user.entity';
import { roleRepository } from '../repositories/role.repository';
import { userRepository, type UserSortField } from '../repositories/user.repository';
import type { AuthUser, PublicRole, PublicUser } from '../types/auth.types';
import { AppError } from '../utils/app-error';
import type { ListQuery, Paginated } from '../utils/pagination';
import { auditService } from './audit.service';
import { rbacService } from './rbac.service';

/* Strips passwordHash and soft-delete internals from API output. */
export function toPublicUser(u: User, roles?: PublicRole[]): PublicUser {
  const out: PublicUser = {
    id: u.id,
    name: u.name,
    email: u.email,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt ?? null,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
  if (roles) out.roles = roles;
  return out;
}

export interface CreateUserInput { name: string; email: string; password: string; roleIds?: string[]; isActive?: boolean }
export interface UpdateUserInput { name?: string; email?: string; password?: string }

export class UserService {
  private hash(password: string) {
    return bcrypt.hash(password, appConfig.bcryptRounds);
  }

  private async rolesOf(userId: string, manager?: EntityManager): Promise<PublicRole[]> {
    const assignments = await roleRepository.findUserAssignments(userId, manager);
    return assignments
      .filter((a) => a.role && !a.role.isDelete)
      .map((a) => ({ id: a.role.id, name: a.role.name, code: a.role.code }));
  }

  /* With includeRoles (callers holding roles.view), each user carries its roles: one query for the page, not one per user. */
  async list(q: ListQuery<UserSortField> & { roleId?: string }, includeRoles = false): Promise<Paginated<PublicUser>> {
    const page = await userRepository.list(q);
    if (!includeRoles || !page.items.length) return { items: page.items.map((u) => toPublicUser(u)), meta: page.meta };
    const assignments = await AppDataSource.getRepository(UserRole).find({
      where: { userId: In(page.items.map((u) => u.id)), isDelete: false },
      relations: { role: true },
      order: { createdAt: 'ASC' },
    });
    const rolesFor = (id: string) => assignments
      .filter((a) => a.userId === id && a.role && !a.role.isDelete)
      .map((a) => ({ id: a.role.id, name: a.role.name, code: a.role.code }));
    return { items: page.items.map((u) => toPublicUser(u, rolesFor(u.id))), meta: page.meta };
  }

  async get(id: string): Promise<PublicUser> {
    const user = await userRepository.findById(id);
    if (!user) throw AppError.notFound('User not found');
    return toPublicUser(user, await this.rolesOf(id));
  }

  async create(input: CreateUserInput, actor: AuthUser, req?: Request): Promise<PublicUser> {
    const email = input.email.toLowerCase();
    const passwordHash = await this.hash(input.password);

    const id = await AppDataSource.transaction(async (m) => {
      if (await userRepository.findByEmail(email, m)) throw AppError.conflict('A user with this email already exists');
      const user = await userRepository.create({ name: input.name, email, passwordHash, isActive: input.isActive ?? true }, m);
      if (input.roleIds?.length) {
        if (!actor.permissions.has('users.assign-roles')) throw AppError.forbidden('You need users.assign-roles to assign roles');
        await this.applyRoles(user.id, input.roleIds, actor, m);
      }
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.USER_CREATE, resource: 'user', resourceId: user.id,
        details: { email, roleIds: input.roleIds ?? [] },
      });
      return user.id;
    });
    rbacService.invalidate();
    return this.get(id);
  }

  async update(id: string, input: UpdateUserInput, actor: AuthUser, req?: Request): Promise<PublicUser> {
    await AppDataSource.transaction(async (m) => {
      const user = await userRepository.findById(id, { manager: m });
      if (!user) throw AppError.notFound('User not found');
      const patch: Partial<Pick<User, 'name' | 'email' | 'passwordHash'>> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.email !== undefined) {
        const email = input.email.toLowerCase();
        const other = await userRepository.findByEmail(email, m);
        if (other && other.id !== id) throw AppError.conflict('A user with this email already exists');
        patch.email = email;
      }
      if (input.password !== undefined) patch.passwordHash = await this.hash(input.password);
      await userRepository.update(id, patch, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.USER_UPDATE, resource: 'user', resourceId: id,
        details: { fields: Object.keys(input), self: actor.id === id },
      });
    });
    return this.get(id);
  }

  async setStatus(id: string, isActive: boolean, actor: AuthUser, req?: Request): Promise<PublicUser> {
    if (id === actor.id && !isActive) throw AppError.forbidden('You cannot deactivate your own account');
    await AppDataSource.transaction(async (m) => {
      const user = await userRepository.findById(id, { manager: m });
      if (!user) throw AppError.notFound('User not found');
      if (!isActive) await this.assertNotLastSuperAdmin(id, m);
      await userRepository.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, { action: AUDIT_ACTIONS.USER_STATUS, resource: 'user', resourceId: id, details: { isActive } });
    });
    rbacService.invalidate();
    return this.get(id);
  }

  async remove(id: string, actor: AuthUser, req?: Request): Promise<void> {
    if (id === actor.id) throw AppError.forbidden('You cannot delete your own account');
    await AppDataSource.transaction(async (m) => {
      if (!(await userRepository.findById(id, { manager: m }))) throw AppError.notFound('User not found');
      await this.assertNotLastSuperAdmin(id, m);
      await userRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, { action: AUDIT_ACTIONS.USER_DELETE, resource: 'user', resourceId: id });
    });
    rbacService.invalidate();
  }

  /* Restores a soft-deleted user as INACTIVE; an administrator activates it explicitly. */
  async restore(id: string, req?: Request): Promise<PublicUser> {
    await AppDataSource.transaction(async (m) => {
      const existing = await userRepository.findByIdIncludingDeleted(id, m);
      if (!existing) throw AppError.notFound('User not found');
      if (!existing.isDelete) throw AppError.conflict('User is not deleted');
      if (await userRepository.findByEmail(existing.email, m)) throw AppError.conflict('Another active user already uses this email');
      await userRepository.restore(id, m);
      await auditService.recordInTx(m, req, { action: AUDIT_ACTIONS.USER_RESTORE, resource: 'user', resourceId: id });
    });
    rbacService.invalidate();
    return this.get(id);
  }

  async getRoles(id: string): Promise<PublicRole[]> {
    if (!(await userRepository.findById(id))) throw AppError.notFound('User not found');
    return this.rolesOf(id);
  }

  /* Replaces the user's role set atomically (soft-deletes removed assignments, adds new ones). */
  async replaceRoles(id: string, roleIds: string[], actor: AuthUser, req?: Request): Promise<PublicRole[]> {
    if (id === actor.id) throw new AppError(403, 'You cannot change your own roles', 'SELF_PRIVILEGE_CHANGE');
    await AppDataSource.transaction(async (m) => {
      if (!(await userRepository.findById(id, { manager: m }))) throw AppError.notFound('User not found');
      const { added, removed } = await this.applyRoles(id, roleIds, actor, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.USER_ROLES_REPLACE, resource: 'user', resourceId: id,
        details: { roleIds, added, removed },
      });
    });
    rbacService.invalidate();
    return this.rolesOf(id);
  }

  private async applyRoles(userId: string, roleIds: string[], actor: AuthUser, m: EntityManager) {
    const wanted = [...new Set(roleIds)];
    const roles = await roleRepository.findUsableByIds(wanted, m);
    if (roles.length !== wanted.length) {
      const found = new Set(roles.map((r) => r.id));
      throw AppError.badRequest('Some roles do not exist, are deleted or are inactive', wanted.filter((r) => !found.has(r)).map((r) => ({ field: 'roleIds', message: r })));
    }

    const current = await roleRepository.findUserAssignments(userId, m);
    const currentIds = new Set(current.map((a) => a.roleId));
    const toAdd = roles.filter((r) => !currentIds.has(r.id));
    const toRemove = current.filter((a) => !wanted.includes(a.roleId));

    /* Granting needs every permission of the role; removing needs the same (cannot strip what you do not hold). */
    await rbacService.assertCanGrantRoles(actor, [...toAdd, ...toRemove.map((a) => a.role).filter(Boolean)], m);
    if (toRemove.some((a) => a.role?.code === ROLE_CODES.SUPER_ADMIN)) await this.assertNotLastSuperAdmin(userId, m);

    const repo = m.getRepository(UserRole);
    if (toRemove.length) await repo.update(toRemove.map((a) => a.id), { isDelete: true, isActive: false });
    if (toAdd.length) await repo.insert(toAdd.map((r) => ({ userId, roleId: r.id, assignedById: actor.id })));
    return { added: toAdd.map((r) => r.code), removed: toRemove.map((a) => a.role?.code ?? a.roleId) };
  }

  /* There must always be at least one active Super Admin other than `userId`, if `userId` is one. */
  private async assertNotLastSuperAdmin(userId: string, m: EntityManager): Promise<void> {
    const rows: { userId: string }[] = await m.query(
      `SELECT DISTINCT ur."userId"
         FROM "user_roles" ur
         JOIN "roles" r ON r."id" = ur."roleId" AND r."isDelete" = false AND r."isActive" = true AND r."code" = $1
         JOIN "users" u ON u."id" = ur."userId" AND u."isDelete" = false AND u."isActive" = true
        WHERE ur."isDelete" = false`,
      [ROLE_CODES.SUPER_ADMIN],
    );
    const ids = rows.map((r) => r.userId);
    if (ids.includes(userId) && ids.length <= 1) {
      throw AppError.conflict('This is the last active Super Admin; assign another Super Admin first');
    }
  }
}

export const userService = new UserService();
