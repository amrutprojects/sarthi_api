import { In, type EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { AppError } from '../../shared/errors/app-error';
import type { AuthUser, PublicRole } from '../auth';
import { rbacService } from './rbac.service';
import { ROLE_CODES } from './role.constants';
import { roleRepository } from './roles/role.repository';
import { UserRole } from './user-role.entity';

const toPublicRole = (a: UserRole): PublicRole => ({ id: a.role.id, name: a.role.name, code: a.role.code });

/*
 * Owner of the user ↔ role assignments (user_roles). Other modules (users) read and change
 * assignments only through this service, never through the repository or the entity directly.
 */
export class RoleAssignmentService {
  async rolesOfUser(userId: string, manager?: EntityManager): Promise<PublicRole[]> {
    const assignments = await roleRepository.findUserAssignments(userId, manager);
    return assignments.filter((a) => a.role && !a.role.isDelete).map(toPublicRole);
  }

  /* Roles of many users in one query (list pages). */
  async rolesOfUsers(userIds: string[]): Promise<Map<string, PublicRole[]>> {
    const out = new Map<string, PublicRole[]>(userIds.map((id) => [id, []]));
    if (!userIds.length) return out;
    const assignments = await AppDataSource.getRepository(UserRole).find({
      where: { userId: In(userIds), isDelete: false },
      relations: { role: true },
      order: { createdAt: 'ASC' },
    });
    for (const a of assignments) if (a.role && !a.role.isDelete) out.get(a.userId)?.push(toPublicRole(a));
    return out;
  }

  /* Replaces a user's role set inside the caller's transaction, enforcing the anti-escalation rules. */
  async replaceUserRoles(userId: string, roleIds: string[], actor: AuthUser, m: EntityManager) {
    const wanted = [...new Set(roleIds)];
    const roles = await roleRepository.findUsableByIds(wanted, m);
    if (roles.length !== wanted.length) {
      const found = new Set(roles.map((r) => r.id));
      throw AppError.badRequest(
        'Some roles do not exist, are deleted or are inactive',
        wanted.filter((r) => !found.has(r)).map((r) => ({ field: 'roleIds', message: r })),
      );
    }
    rbacService.assertExclusiveRoles(roles);

    const current = await roleRepository.findUserAssignments(userId, m);
    const currentIds = new Set(current.map((a) => a.roleId));
    const toAdd = roles.filter((r) => !currentIds.has(r.id));
    const toRemove = current.filter((a) => !wanted.includes(a.roleId));

    /* Granting needs every permission of the role; removing needs the same (cannot strip what you do not hold). */
    await rbacService.assertCanGrantRoles(actor, [...toAdd, ...toRemove.map((a) => a.role).filter(Boolean)], m);
    if (toRemove.some((a) => a.role?.code === ROLE_CODES.SUPER_ADMIN)) await this.assertNotLastSuperAdmin(userId, m);

    const repo = m.getRepository(UserRole);
    if (toRemove.length)
      await repo.update(
        toRemove.map((a) => a.id),
        { isDelete: true, isActive: false },
      );
    if (toAdd.length) await repo.insert(toAdd.map((r) => ({ userId, roleId: r.id, assignedById: actor.id })));
    return { added: toAdd.map((r) => r.code), removed: toRemove.map((a) => a.role?.code ?? a.roleId) };
  }

  /* There must always be at least one active Super Admin other than `userId`, if `userId` is one. */
  async assertNotLastSuperAdmin(userId: string, m: EntityManager): Promise<void> {
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

export const roleAssignmentService = new RoleAssignmentService();
