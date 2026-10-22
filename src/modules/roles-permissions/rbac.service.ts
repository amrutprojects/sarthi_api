import type { EntityManager } from 'typeorm';
import { ERROR_CODES, HTTP_STATUS } from '../../constants/api-response.constants';
import { appConfig } from '../../config/app.config';
import { isWebsitePermission } from './permission.constants';
import { ROLE_CODES } from './role.constants';
import type { Permission } from './permissions/permission.entity';
import type { Role } from './roles/role.entity';
import { permissionRepository } from './permissions/permission.repository';
import { roleRepository } from './roles/role.repository';
import type { AuthUser } from '../auth';
import { AppError } from '../../shared/errors/app-error';

interface CacheEntry {
  codes: Set<string>;
  roleCodes: string[];
  at: number;
}

/* The admin panel workspace an account signs in to: the full panel, or the CMS-only one of a Website Admin. */
export type Portal = 'admin' | 'website';

/*
 * Database-driven RBAC.
 *
 * Effective permissions = permissions granted (non-deleted grant, active permission) by the user's
 * roles (non-deleted assignment, active role), for an active, non-deleted user. Resolved per user and
 * cached for PERMISSION_CACHE_TTL_MS; any change to users, roles, permissions or assignments calls
 * invalidate(), which drops the whole cache. With several API instances, the TTL bounds staleness.
 *
 * Anti-escalation rules (enforced in the services, on top of route permissions):
 * 1. Nobody can change their own role assignments.
 * 2. An actor can only grant a role whose permissions they already hold themselves.
 * 3. An actor can only grant a permission to a role if they hold that permission themselves.
 * 4. Only a Super Admin may change the permissions of a role they hold (that would change their own access).
 * 5. The SUPER_ADMIN role cannot be deleted, deactivated or have its grants edited through the API,
 *    and the last active Super Admin cannot be removed, deactivated or deleted.
 * 6. The WEBSITE_ADMIN role grants website (CMS menu) permissions only.
 * 7. A Website Admin holds no other role. With rule 6 this keeps a Website Admin account inside the CMS; as a
 *    backstop, getAuthorization() drops any other code such an account would get (e.g. from a direct database edit).
 */
export class RbacService {
  private cache = new Map<string, CacheEntry>();

  async getAuthorization(userId: string, manager?: EntityManager): Promise<{ permissions: Set<string>; roleCodes: string[] }> {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.at < appConfig.permissionCacheTtlMs) return { permissions: hit.codes, roleCodes: hit.roleCodes };

    const [codes, assignments] = await Promise.all([
      permissionRepository.findEffectiveCodesForUser(userId, manager),
      roleRepository.findUserAssignments(userId, manager),
    ]);
    const roleCodes = assignments.filter((a) => a.role && !a.role.isDelete && a.role.isActive).map((a) => a.role.code);
    /* Rules 6 and 7, enforced again at the source: a Website Admin's effective permissions never leave the website. */
    const effective = roleCodes.includes(ROLE_CODES.WEBSITE_ADMIN) ? codes.filter(isWebsitePermission) : codes;
    const entry: CacheEntry = { codes: new Set(effective), roleCodes, at: Date.now() };
    if (appConfig.permissionCacheTtlMs > 0) this.cache.set(userId, entry);
    return { permissions: entry.codes, roleCodes };
  }

  invalidate(): void {
    this.cache.clear();
  }

  hasPermission(auth: AuthUser, code: string): boolean {
    return auth.permissions.has(code);
  }

  isSuperAdmin(auth: AuthUser): boolean {
    return auth.roleCodes.includes(ROLE_CODES.SUPER_ADMIN);
  }

  /*
   * Workspace of an account from the codes of its assigned roles. Inactive roles count too: a Website Admin whose
   * role is deactivated gets an empty CMS workspace, not the programme panel.
   */
  portalOf(roleCodes: string[]): Portal {
    return roleCodes.includes(ROLE_CODES.WEBSITE_ADMIN) ? 'website' : 'admin';
  }

  /* Rule 6. */
  assertWithinRoleScope(role: Pick<Role, 'code'>, permissions: Pick<Permission, 'code'>[]): void {
    if (role.code !== ROLE_CODES.WEBSITE_ADMIN) return;
    const outside = permissions.filter((p) => !isWebsitePermission(p.code)).map((p) => p.code);
    if (outside.length) {
      throw AppError.badRequest(
        'The Website Admin role can only hold permissions of the CMS menu',
        outside.map((m) => ({ field: 'permissionIds', message: m })),
      );
    }
  }

  /* Rule 7, on the complete role set a user is about to hold. */
  assertExclusiveRoles(roles: Pick<Role, 'code'>[]): void {
    if (roles.length > 1 && roles.some((r) => r.code === ROLE_CODES.WEBSITE_ADMIN)) {
      throw AppError.badRequest('A Website Admin cannot hold any other role', [{ field: 'roleIds', message: ROLE_CODES.WEBSITE_ADMIN }]);
    }
  }

  /* Rule 2: every permission the roles carry must already be held by the actor. */
  async assertCanGrantRoles(actor: AuthUser, roles: Role[], manager?: EntityManager): Promise<void> {
    for (const role of roles) {
      const grants = await roleRepository.findRolePermissionGrants(role.id, manager);
      const missing = grants
        .map((g) => g.permission)
        .filter((p) => p && !p.isDelete && p.isActive && !actor.permissions.has(p.code))
        .map((p) => p.code);
      if (missing.length) {
        throw new AppError(
          HTTP_STATUS.FORBIDDEN,
          `You cannot assign role ${role.code}: it grants permissions you do not hold`,
          ERROR_CODES.PRIVILEGE_ESCALATION,
          missing.map((m) => ({ field: 'roleIds', message: m })),
        );
      }
    }
  }

  /* Rule 3. */
  assertCanGrantPermissions(actor: AuthUser, permissions: Permission[]): void {
    const missing = permissions.filter((p) => !actor.permissions.has(p.code)).map((p) => p.code);
    if (missing.length) {
      throw new AppError(
        HTTP_STATUS.FORBIDDEN,
        'You cannot grant permissions you do not hold',
        ERROR_CODES.PRIVILEGE_ESCALATION,
        missing.map((m) => ({ field: 'permissionIds', message: m })),
      );
    }
  }

  /* Rule 4. */
  assertNotEditingOwnRole(actor: AuthUser, role: Role): void {
    if (actor.roleCodes.includes(role.code) && !this.isSuperAdmin(actor)) {
      throw new AppError(HTTP_STATUS.FORBIDDEN, 'You cannot change the permissions of a role you hold', ERROR_CODES.SELF_PRIVILEGE_CHANGE);
    }
  }

  /* Rule 5 (role side). */
  assertNotProtectedRole(role: Role, operation: string): void {
    if (role.code === ROLE_CODES.SUPER_ADMIN) {
      throw new AppError(HTTP_STATUS.FORBIDDEN, `The ${ROLE_CODES.SUPER_ADMIN} role cannot be ${operation}`, ERROR_CODES.PROTECTED_ROLE);
    }
  }
}

export const rbacService = new RbacService();
