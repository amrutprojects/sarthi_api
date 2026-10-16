import type { Request } from 'express';
import { AppDataSource } from '../config/database.config';
import { AUDIT_ACTIONS } from '../constants/app.constants';
import { RolePermission } from '../entities/role-permission.entity';
import type { Role } from '../entities/role.entity';
import { permissionRepository } from '../repositories/permission.repository';
import { roleRepository, type RoleSortField } from '../repositories/role.repository';
import type { AuthUser } from '../types/auth.types';
import { AppError } from '../utils/app-error';
import type { ListQuery, Paginated } from '../utils/pagination';
import { auditService } from './audit.service';
import { rbacService } from './rbac.service';

export interface PublicRoleDetail {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  permissions?: { id: string; code: string; name: string; module: string }[];
}

const toPublic = (r: Role): PublicRoleDetail => ({
  id: r.id, name: r.name, code: r.code, description: r.description, isSystem: r.isSystem,
  isActive: r.isActive, createdAt: r.createdAt, updatedAt: r.updatedAt,
});

export interface CreateRoleInput { name: string; code: string; description?: string | null; isActive?: boolean; permissionIds?: string[] }
export interface UpdateRoleInput { name?: string; description?: string | null }

export class RoleService {
  async list(q: ListQuery<RoleSortField>): Promise<Paginated<PublicRoleDetail>> {
    const page = await roleRepository.list(q);
    return { items: page.items.map(toPublic), meta: page.meta };
  }

  async get(id: string): Promise<PublicRoleDetail> {
    const role = await roleRepository.findById(id);
    if (!role) throw AppError.notFound('Role not found');
    return { ...toPublic(role), permissions: await this.permissionsOf(id) };
  }

  private async permissionsOf(roleId: string) {
    const grants = await roleRepository.findRolePermissionGrants(roleId);
    return grants
      .filter((g) => g.permission && !g.permission.isDelete)
      .map((g) => ({ id: g.permission.id, code: g.permission.code, name: g.permission.name, module: g.permission.module }));
  }

  async create(input: CreateRoleInput, actor: AuthUser, req?: Request): Promise<PublicRoleDetail> {
    const id = await AppDataSource.transaction(async (m) => {
      if (await roleRepository.findByCode(input.code, m)) throw AppError.conflict('A role with this code already exists');
      const role = await roleRepository.create({
        name: input.name, code: input.code, description: input.description ?? null, isActive: input.isActive ?? true, isSystem: false,
      }, m);
      if (input.permissionIds?.length) {
        if (!actor.permissions.has('permissions.assign')) throw AppError.forbidden('You need permissions.assign to grant permissions');
        const perms = await permissionRepository.findUsableByIds([...new Set(input.permissionIds)], m);
        if (perms.length !== new Set(input.permissionIds).size) throw AppError.badRequest('Some permissions do not exist, are deleted or are inactive');
        rbacService.assertCanGrantPermissions(actor, perms);
        await m.getRepository(RolePermission).insert(perms.map((p) => ({ roleId: role.id, permissionId: p.id, assignedById: actor.id })));
      }
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ROLE_CREATE, resource: 'role', resourceId: role.id,
        details: { code: role.code, permissionIds: input.permissionIds ?? [] },
      });
      return role.id;
    });
    rbacService.invalidate();
    return this.get(id);
  }

  async update(id: string, input: UpdateRoleInput, req?: Request): Promise<PublicRoleDetail> {
    await AppDataSource.transaction(async (m) => {
      const role = await roleRepository.findById(id, { manager: m });
      if (!role) throw AppError.notFound('Role not found');
      await roleRepository.update(id, { ...input }, m);
      await auditService.recordInTx(m, req, { action: AUDIT_ACTIONS.ROLE_UPDATE, resource: 'role', resourceId: id, details: { fields: Object.keys(input) } });
    });
    return this.get(id);
  }

  async setStatus(id: string, isActive: boolean, req?: Request): Promise<PublicRoleDetail> {
    await AppDataSource.transaction(async (m) => {
      const role = await roleRepository.findById(id, { manager: m });
      if (!role) throw AppError.notFound('Role not found');
      if (!isActive) rbacService.assertNotProtectedRole(role, 'deactivated');
      await roleRepository.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, { action: AUDIT_ACTIONS.ROLE_STATUS, resource: 'role', resourceId: id, details: { isActive } });
    });
    rbacService.invalidate();
    return this.get(id);
  }

  /* Soft-deletes the role and its grants/assignments so it stops granting access; rows are kept for history. */
  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const role = await roleRepository.findById(id, { manager: m });
      if (!role) throw AppError.notFound('Role not found');
      rbacService.assertNotProtectedRole(role, 'deleted');
      if (role.isSystem) throw new AppError(403, 'System roles cannot be deleted', 'PROTECTED_ROLE');
      const holders = await roleRepository.countActiveHolders(id, m);
      await roleRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, { action: AUDIT_ACTIONS.ROLE_DELETE, resource: 'role', resourceId: id, details: { code: role.code, holders } });
    });
    rbacService.invalidate();
  }

  async restore(id: string, req?: Request): Promise<PublicRoleDetail> {
    await AppDataSource.transaction(async (m) => {
      const existing = await roleRepository.findByIdIncludingDeleted(id, m);
      if (!existing) throw AppError.notFound('Role not found');
      if (!existing.isDelete) throw AppError.conflict('Role is not deleted');
      if (await roleRepository.findByCode(existing.code, m)) throw AppError.conflict('Another active role already uses this code');
      await roleRepository.restore(id, m);
      await auditService.recordInTx(m, req, { action: AUDIT_ACTIONS.ROLE_RESTORE, resource: 'role', resourceId: id });
    });
    rbacService.invalidate();
    return this.get(id);
  }

  async getPermissions(id: string) {
    if (!(await roleRepository.findById(id))) throw AppError.notFound('Role not found');
    return this.permissionsOf(id);
  }

  /* Replaces the role's permission set atomically, with the anti-escalation checks of RbacService. */
  async replacePermissions(id: string, permissionIds: string[], actor: AuthUser, req?: Request) {
    await AppDataSource.transaction(async (m) => {
      const role = await roleRepository.findById(id, { manager: m });
      if (!role) throw AppError.notFound('Role not found');
      if (!role.isActive) throw AppError.badRequest('Cannot change the permissions of an inactive role');
      rbacService.assertNotProtectedRole(role, 'edited');
      rbacService.assertNotEditingOwnRole(actor, role);

      const wanted = [...new Set(permissionIds)];
      const perms = await permissionRepository.findUsableByIds(wanted, m);
      if (perms.length !== wanted.length) {
        const found = new Set(perms.map((p) => p.id));
        throw AppError.badRequest('Some permissions do not exist, are deleted or are inactive', wanted.filter((p) => !found.has(p)).map((p) => ({ field: 'permissionIds', message: p })));
      }

      const current = await roleRepository.findRolePermissionGrants(id, m);
      const currentIds = new Set(current.map((g) => g.permissionId));
      const toAdd = perms.filter((p) => !currentIds.has(p.id));
      const toRemove = current.filter((g) => !wanted.includes(g.permissionId));
      rbacService.assertCanGrantPermissions(actor, [...toAdd, ...toRemove.map((g) => g.permission).filter((p) => p && !p.isDelete)]);

      const repo = m.getRepository(RolePermission);
      if (toRemove.length) await repo.update(toRemove.map((g) => g.id), { isDelete: true, isActive: false });
      if (toAdd.length) await repo.insert(toAdd.map((p) => ({ roleId: id, permissionId: p.id, assignedById: actor.id })));
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ROLE_PERMISSIONS_REPLACE, resource: 'role', resourceId: id,
        details: { code: role.code, added: toAdd.map((p) => p.code), removed: toRemove.map((g) => g.permission?.code ?? g.permissionId) },
      });
    });
    rbacService.invalidate();
    return this.permissionsOf(id);
  }
}

export const roleService = new RoleService();
