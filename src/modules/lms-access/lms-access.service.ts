import { randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import type { Request } from 'express';
import { In } from 'typeorm';
import { ERROR_CODES, HTTP_STATUS, MESSAGES, RESPONSE_MESSAGES } from '../../constants/api-response.constants';
import { AppDataSource } from '../../config/database.config';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { AppError } from '../../shared/errors/app-error';
import { auditService } from '../audit';
import type { AuthUser } from '../auth';
import { Role, rbacService } from '../roles-permissions';
import { userService } from '../users';
import { LMS_CODES, lmsCatalogue } from './lms-catalogue';
import { RoleLmsPermission } from './role-lms-permission.entity';

/* A real bcrypt hash of a random value, so an unknown email costs the same time as a wrong password. */
const DUMMY_HASH = bcrypt.hashSync(randomUUID(), 10);

export interface RoleLmsAccess {
  roleId: string;
  code: string;
  name: string;
  codes: string[];
}

/* What the LMS receives for an Admin Panel user: identity, roles and the LMS codes ticked on those roles. */
export interface LmsAccess {
  user: { id: string; email: string; name: string };
  active: boolean;
  /*
   * The user's active LMS roles (Admin Panel roles are never sent), each with its own LMS codes, so the LMS can mirror
   * every role separately without one holder's other roles leaking into it.
   */
  roles: { code: string; name: string; lmsPermissions: string[] }[];
  /* Union of the roles' codes: what this user may do in the LMS. */
  lmsPermissions: string[];
}

/*
 * LMS roles managed in Admin Panel → Users & Roles, and the sign-in check the LMS calls for Admin Panel users.
 *
 * An LMS role (roles.platform = LMS) carries LMS menus: LMS permission codes (lms-catalogue.data.ts) stored in
 * role_lms_permissions, apart from the Admin Panel's own role_permissions, which an LMS role never holds. So an LMS
 * role grants nothing in the Admin Panel, and Admin Panel roles and menus are never sent to the LMS.
 */
export class LmsAccessService {
  private repo() {
    return AppDataSource.getRepository(RoleLmsPermission);
  }

  catalogue() {
    return lmsCatalogue();
  }

  async forRole(roleId: string): Promise<RoleLmsAccess> {
    const role = await AppDataSource.getRepository(Role).findOne({ where: { id: roleId, isDelete: false } });
    if (!role) throw AppError.notFound(MESSAGES.notFound('Role'));
    const rows = await this.repo().find({ where: { roleId, isDelete: false }, order: { code: 'ASC' } });
    return { roleId: role.id, code: role.code, name: role.name, codes: rows.map((r) => r.code) };
  }

  /* Same guard rails as the role's own permissions: no inactive role, and no editing a role you hold unless Super Admin. */
  async replaceForRole(roleId: string, codes: string[], actor: AuthUser, req?: Request): Promise<RoleLmsAccess> {
    const wanted = [...new Set(codes)];
    const unknown = wanted.filter((c) => !LMS_CODES.has(c));
    if (unknown.length) {
      throw AppError.badRequest(
        'Some LMS permissions do not exist',
        unknown.map((c) => ({ field: 'codes', message: c })),
      );
    }

    await AppDataSource.transaction(async (m) => {
      const role = await m.getRepository(Role).findOne({ where: { id: roleId, isDelete: false } });
      if (!role) throw AppError.notFound(MESSAGES.notFound('Role'));
      if (role.platform !== 'LMS') throw AppError.badRequest('Only LMS roles carry LMS menus');
      if (!role.isActive) throw AppError.badRequest('Cannot change the LMS menus of an inactive role');
      rbacService.assertNotEditingOwnRole(actor, role);

      const repo = m.getRepository(RoleLmsPermission);
      const current = await repo.find({ where: { roleId, isDelete: false } });
      const have = new Set(current.map((r) => r.code));
      const toAdd = wanted.filter((c) => !have.has(c));
      const toRemove = current.filter((r) => !wanted.includes(r.code));
      if (!toAdd.length && !toRemove.length) return;

      if (toRemove.length)
        await repo.update(
          toRemove.map((r) => r.id),
          { isDelete: true, isActive: false },
        );
      if (toAdd.length) await repo.insert(toAdd.map((code) => ({ roleId, code, assignedById: actor.id })));
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ROLE_LMS_PERMISSIONS_REPLACE,
        resource: 'role',
        resourceId: roleId,
        details: { code: role.code, added: toAdd, removed: toRemove.map((r) => r.code) },
      });
    });
    return this.forRole(roleId);
  }

  /* Current LMS access of an Admin Panel user: their active LMS roles, and the union of the LMS menus ticked on them. */
  async accessFor(userId: string): Promise<LmsAccess | null> {
    const user = await userService.findAccount(userId);
    if (!user) return null;
    const { roleCodes } = await rbacService.getAuthorization(user.id);
    const roles = roleCodes.length
      ? await AppDataSource.getRepository(Role).find({ where: { code: In(roleCodes), platform: 'LMS', isDelete: false, isActive: true } })
      : [];
    const rows = roles.length ? await this.repo().find({ where: { roleId: In(roles.map((r) => r.id)), isDelete: false } }) : [];
    const active = user.isActive;
    const codesOf = (roleId?: string) =>
      active
        ? [...new Set(rows.filter((r) => !roleId || r.roleId === roleId).map((r) => r.code))].filter((c) => LMS_CODES.has(c)).sort()
        : [];
    return {
      user: { id: user.id, email: user.email, name: user.name },
      active,
      roles: roles.map((r) => ({ code: r.code, name: r.name, lmsPermissions: codesOf(r.id) })),
      lmsPermissions: codesOf(),
    };
  }

  /*
   * Called by the LMS when an Admin Panel user signs in there. Same answer for an unknown email, a wrong password and
   * an inactive account (no enumeration); a valid account whose roles tick no LMS menu is refused with NO_LMS_ACCESS.
   */
  async verifySignIn(email: string, password: string, req?: Request): Promise<LmsAccess> {
    const user = await userService.findForLogin(email);
    const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    const refuse = async (reason: string) =>
      auditService.record(req, {
        action: AUDIT_ACTIONS.LMS_SIGN_IN_REFUSED,
        resource: 'auth',
        resourceId: user?.id ?? null,
        actorUserId: user?.id ?? null,
        outcome: 'FAILURE',
        details: { reason },
      });

    if (!user || !passwordOk || !user.isActive) {
      await refuse(!user ? 'unknown_email' : !passwordOk ? 'bad_password' : 'inactive');
      throw AppError.unauthorized(RESPONSE_MESSAGES.INVALID_CREDENTIALS);
    }
    const access = await this.accessFor(user.id);
    if (!access || !access.lmsPermissions.length) {
      await refuse('no_lms_menus');
      throw new AppError(HTTP_STATUS.FORBIDDEN, 'This user holds no LMS role with LMS menus ticked', ERROR_CODES.NO_LMS_ACCESS);
    }
    await auditService.record(req, {
      action: AUDIT_ACTIONS.LMS_SIGN_IN,
      resource: 'auth',
      resourceId: user.id,
      actorUserId: user.id,
      details: { lmsPermissions: access.lmsPermissions.length },
    });
    return access;
  }
}

export const lmsAccessService = new LmsAccessService();
