import type { Request } from 'express';
import { In } from 'typeorm';
import { AppDataSource } from '../../../config/database.config';
import { AUDIT_ACTIONS } from '../../../shared/constants/app.constants';
import { VISIBILITY_MENUS } from '../permission.constants';
import { ROLE_CODES } from '../role.constants';
import { RoleMenuVisibility } from './role-menu-visibility.entity';
import { Role } from '../roles/role.entity';
import { AppError } from '../../../shared/errors/app-error';
import { auditService } from '../../audit';

export interface MenuVisibilityChange { roleId: string; menuKey: string; visible: boolean }

/* Menus a Super Admin can never hide from itself (it would lock everyone out of access management). */
const SUPER_ADMIN_LOCKED = ['users'];

export class MenuVisibilityService {
  private repo() {
    return AppDataSource.getRepository(RoleMenuVisibility);
  }

  /* Matrix for the admin panel: every menu, and per non-deleted role the menus it hides. */
  async matrix() {
    const roles = await AppDataSource.getRepository(Role).find({ where: { isDelete: false }, order: { name: 'ASC' } });
    const rows = await this.repo().find({ where: { isDelete: false, isVisible: false } });
    return {
      menus: VISIBILITY_MENUS,
      lockedForSuperAdmin: SUPER_ADMIN_LOCKED,
      roles: roles.map((r) => ({
        id: r.id, code: r.code, name: r.name, isActive: r.isActive,
        hidden: rows.filter((v) => v.roleId === r.id).map((v) => v.menuKey).sort(),
      })),
    };
  }

  /* A menu is hidden for a user only when every one of their active roles hides it. */
  async hiddenMenusFor(roleCodes: string[]): Promise<string[]> {
    if (!roleCodes.length) return [];
    const roles = await AppDataSource.getRepository(Role).find({ where: { code: In(roleCodes), isDelete: false, isActive: true } });
    if (!roles.length) return [];
    const rows = await this.repo().find({ where: { roleId: In(roles.map((r) => r.id)), isDelete: false, isVisible: false } });
    return VISIBILITY_MENUS.filter((menu) => roles.every((r) => rows.some((v) => v.roleId === r.id && v.menuKey === menu)));
  }

  async apply(changes: MenuVisibilityChange[], req?: Request) {
    const unknown = changes.filter((c) => !VISIBILITY_MENUS.includes(c.menuKey));
    if (unknown.length) throw AppError.badRequest(`Unknown menu: ${unknown.map((c) => c.menuKey).join(', ')}`);

    await AppDataSource.transaction(async (m) => {
      const roleIds = [...new Set(changes.map((c) => c.roleId))];
      const roles = await m.getRepository(Role).find({ where: { id: In(roleIds), isDelete: false } });
      if (roles.length !== roleIds.length) throw AppError.notFound('Role not found');
      const superAdmin = roles.find((r) => r.code === ROLE_CODES.SUPER_ADMIN);
      if (superAdmin && changes.some((c) => c.roleId === superAdmin.id && !c.visible && SUPER_ADMIN_LOCKED.includes(c.menuKey))) {
        throw AppError.forbidden('The Users & Roles menu cannot be hidden from Super Admin');
      }
      const repo = m.getRepository(RoleMenuVisibility);
      for (const c of changes) {
        const row = await repo.findOne({ where: { roleId: c.roleId, menuKey: c.menuKey, isDelete: false } });
        if (row) {
          if (row.isVisible !== c.visible) await repo.update(row.id, { isVisible: c.visible });
        } else if (!c.visible) {
          await repo.insert({ roleId: c.roleId, menuKey: c.menuKey, isVisible: false });
        }
      }
    });
    await auditService.record(req, {
      action: AUDIT_ACTIONS.MENU_VISIBILITY_UPDATE, resource: 'role',
      details: { changes: changes.map((c) => `${c.roleId}:${c.menuKey}=${c.visible ? 'shown' : 'hidden'}`) },
    });
    return this.matrix();
  }
}

export const menuVisibilityService = new MenuVisibilityService();
