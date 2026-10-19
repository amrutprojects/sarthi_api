import bcrypt from 'bcrypt';
import type { Request } from 'express';
import { AppDataSource } from '../../config/database.config';
import { appConfig } from '../../config/app.config';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import type { User } from './user.entity';
import { toPublicUser } from './user.mapper';
import { userRepository, type UserSortField } from './user.repository';
import type { AuthUser, PublicRole, PublicUser } from '../auth';
import { AppError } from '../../shared/errors/app-error';
import type { ListQuery, Paginated } from '../../shared/utils/pagination';
import { auditService } from '../audit';
import { rbacService, roleAssignmentService } from '../roles-permissions';

export interface CreateUserInput { name: string; email: string; password: string; roleIds?: string[]; isActive?: boolean }
export interface UpdateUserInput { name?: string; email?: string; password?: string }

export class UserService {
  private hash(password: string) {
    return bcrypt.hash(password, appConfig.bcryptRounds);
  }

  /* Credentials and session checks for the auth module (the only place that sees passwordHash). */
  findForLogin(email: string): Promise<User | null> {
    return userRepository.findByEmailWithPassword(email);
  }

  async findAccount(id: string): Promise<User | null> {
    return userRepository.findById(id);
  }

  async recordLogin(id: string): Promise<void> {
    await userRepository.update(id, { lastLoginAt: new Date() });
  }

  /* With includeRoles (callers holding roles.view), each user carries its roles: one query for the page, not one per user. */
  async list(q: ListQuery<UserSortField> & { roleId?: string }, includeRoles = false): Promise<Paginated<PublicUser>> {
    const page = await userRepository.list(q);
    if (!includeRoles) return { items: page.items.map((u) => toPublicUser(u)), meta: page.meta };
    const roles = await roleAssignmentService.rolesOfUsers(page.items.map((u) => u.id));
    return { items: page.items.map((u) => toPublicUser(u, roles.get(u.id) ?? [])), meta: page.meta };
  }

  async get(id: string): Promise<PublicUser> {
    const user = await userRepository.findById(id);
    if (!user) throw AppError.notFound('User not found');
    return toPublicUser(user, await roleAssignmentService.rolesOfUser(id));
  }

  async create(input: CreateUserInput, actor: AuthUser, req?: Request): Promise<PublicUser> {
    const email = input.email.toLowerCase();
    const passwordHash = await this.hash(input.password);

    const id = await AppDataSource.transaction(async (m) => {
      if (await userRepository.findByEmail(email, m)) throw AppError.conflict('A user with this email already exists');
      const user = await userRepository.create({ name: input.name, email, passwordHash, isActive: input.isActive ?? true }, m);
      if (input.roleIds?.length) {
        if (!actor.permissions.has('users.assign-roles')) throw AppError.forbidden('You need users.assign-roles to assign roles');
        await roleAssignmentService.replaceUserRoles(user.id, input.roleIds, actor, m);
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
      if (!isActive) await roleAssignmentService.assertNotLastSuperAdmin(id, m);
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
      await roleAssignmentService.assertNotLastSuperAdmin(id, m);
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
    return roleAssignmentService.rolesOfUser(id);
  }

  /* Replaces the user's role set atomically (soft-deletes removed assignments, adds new ones). */
  async replaceRoles(id: string, roleIds: string[], actor: AuthUser, req?: Request): Promise<PublicRole[]> {
    if (id === actor.id) throw new AppError(403, 'You cannot change your own roles', 'SELF_PRIVILEGE_CHANGE');
    await AppDataSource.transaction(async (m) => {
      if (!(await userRepository.findById(id, { manager: m }))) throw AppError.notFound('User not found');
      const { added, removed } = await roleAssignmentService.replaceUserRoles(id, roleIds, actor, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.USER_ROLES_REPLACE, resource: 'user', resourceId: id,
        details: { roleIds, added, removed },
      });
    });
    rbacService.invalidate();
    return roleAssignmentService.rolesOfUser(id);
  }
}

export const userService = new UserService();
