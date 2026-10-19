import type { EntityManager } from 'typeorm';
import { appConfig } from '../../config/app.config';
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
    const entry: CacheEntry = { codes: new Set(codes), roleCodes, at: Date.now() };
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

  /* Rule 2: every permission the roles carry must already be held by the actor. */
  async assertCanGrantRoles(actor: AuthUser, roles: Role[], manager?: EntityManager): Promise<void> {
    for (const role of roles) {
      const grants = await roleRepository.findRolePermissionGrants(role.id, manager);
      const missing = grants
        .map((g) => g.permission)
        .filter((p) => p && !p.isDelete && p.isActive && !actor.permissions.has(p.code))
        .map((p) => p.code);
      if (missing.length) {
        throw new AppError(403, `You cannot assign role ${role.code}: it grants permissions you do not hold`, 'PRIVILEGE_ESCALATION', missing.map((m) => ({ field: 'roleIds', message: m })));
      }
    }
  }

  /* Rule 3. */
  assertCanGrantPermissions(actor: AuthUser, permissions: Permission[]): void {
    const missing = permissions.filter((p) => !actor.permissions.has(p.code)).map((p) => p.code);
    if (missing.length) {
      throw new AppError(403, 'You cannot grant permissions you do not hold', 'PRIVILEGE_ESCALATION', missing.map((m) => ({ field: 'permissionIds', message: m })));
    }
  }

  /* Rule 4. */
  assertNotEditingOwnRole(actor: AuthUser, role: Role): void {
    if (actor.roleCodes.includes(role.code) && !this.isSuperAdmin(actor)) {
      throw new AppError(403, 'You cannot change the permissions of a role you hold', 'SELF_PRIVILEGE_CHANGE');
    }
  }

  /* Rule 5 (role side). */
  assertNotProtectedRole(role: Role, operation: string): void {
    if (role.code === ROLE_CODES.SUPER_ADMIN) {
      throw new AppError(403, `The ${ROLE_CODES.SUPER_ADMIN} role cannot be ${operation}`, 'PROTECTED_ROLE');
    }
  }
}

export const rbacService = new RbacService();
