export const API_VERSION = 'v1';

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100,
} as const;

/* Header used to propagate / return the request correlation id. */
export const REQUEST_ID_HEADER = 'x-request-id';

/* PostgreSQL error codes the error handler translates into HTTP responses. */
export const PG_ERROR = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  INVALID_TEXT_REPRESENTATION: '22P02',
} as const;

export const AUDIT_ACTIONS = {
  LOGIN: 'auth.login',
  LOGIN_FAILED: 'auth.login.failed',
  LOGOUT: 'auth.logout',
  AUTHZ_DENIED: 'authz.denied',
  USER_CREATE: 'user.create',
  USER_UPDATE: 'user.update',
  USER_STATUS: 'user.status',
  USER_DELETE: 'user.delete',
  USER_RESTORE: 'user.restore',
  USER_ROLES_REPLACE: 'user.roles.replace',
  ROLE_CREATE: 'role.create',
  ROLE_UPDATE: 'role.update',
  ROLE_STATUS: 'role.status',
  ROLE_DELETE: 'role.delete',
  ROLE_RESTORE: 'role.restore',
  ROLE_PERMISSIONS_REPLACE: 'role.permissions.replace',
  MENU_VISIBILITY_UPDATE: 'role.menu-visibility.update',
  PERMISSION_CREATE: 'permission.create',
  PERMISSION_UPDATE: 'permission.update',
  PERMISSION_STATUS: 'permission.status',
  PERMISSION_DELETE: 'permission.delete',
  PERMISSION_RESTORE: 'permission.restore',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
