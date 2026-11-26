import { defineDependencies, rowsWhere } from '../../shared/dependencies/dependencies';
import { P } from './permission.constants';

/*
 * What keeps a role or a permission from being deleted (shared/dependencies): the users who hold the role, and the roles
 * that are granted the permission. A deleted user's (or role's) rows are kept for history and do not count. The role's
 * own grants and menu settings are part of the role, not something that uses it.
 */
const LIVE_USER = `"userId" IN (SELECT id FROM users WHERE "isDelete" = false)`;
const LIVE_ROLE = `"roleId" IN (SELECT id FROM roles WHERE "isDelete" = false)`;

export const ROLE_DEPENDENCIES = defineDependencies({
  kind: 'role',
  noun: 'role',
  table: 'roles',
  permission: P.ROLES_DELETE,
  hint: 'Remove the role from those users first.',
  rules: [rowsWhere('user role assignments', 'user_roles', 'roleId', { where: LIVE_USER })],
});

export const PERMISSION_DEPENDENCIES = defineDependencies({
  kind: 'permission',
  noun: 'permission',
  table: 'permissions',
  permission: P.PERMISSIONS_DELETE,
  hint: 'Take it out of those roles first.',
  rules: [rowsWhere('role permission grants', 'role_permissions', 'permissionId', { where: LIVE_ROLE })],
});
