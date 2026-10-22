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
  STATE_CREATE: 'cms.state.create',
  STATE_UPDATE: 'cms.state.update',
  STATE_STATUS: 'cms.state.status',
  STATE_DELETE: 'cms.state.delete',
  STATE_RESTORE: 'cms.state.restore',
  DISTRICT_CREATE: 'cms.district.create',
  DISTRICT_UPDATE: 'cms.district.update',
  DISTRICT_STATUS: 'cms.district.status',
  DISTRICT_DELETE: 'cms.district.delete',
  DISTRICT_RESTORE: 'cms.district.restore',
  TALUKA_CREATE: 'cms.taluka.create',
  TALUKA_UPDATE: 'cms.taluka.update',
  TALUKA_STATUS: 'cms.taluka.status',
  TALUKA_DELETE: 'cms.taluka.delete',
  TALUKA_RESTORE: 'cms.taluka.restore',
  CONTACT_PAGE_UPDATE: 'cms.contact-page.update',
  CONTACT_PAGE_STATUS: 'cms.contact-page.status',
  FOOTER_UPDATE: 'cms.footer.update',
  FOOTER_STATUS: 'cms.footer.status',
  MODULES_PAGE_UPDATE: 'cms.modules-page.update',
  HIGHLIGHT_UPDATE: 'cms.programme-highlight.update',
  HIGHLIGHT_STATUS: 'cms.programme-highlight.status',
  HERO_UPDATE: 'cms.home-hero.update',
  HERO_STATUS: 'cms.home-hero.status',
  PROGRAMME_PAGE_UPDATE: 'cms.programme-page.update',
  PROGRAMME_PAGE_STATUS: 'cms.programme-page.status',
  IMPACT_STAT_CREATE: 'cms.amrut-impact-stat.create',
  IMPACT_STAT_UPDATE: 'cms.amrut-impact-stat.update',
  IMPACT_STAT_STATUS: 'cms.amrut-impact-stat.status',
  IMPACT_STAT_DELETE: 'cms.amrut-impact-stat.delete',
  IMPACT_STATS_REORDER: 'cms.amrut-impact-stats.reorder',
  IMPACT_SECTION_UPDATE: 'cms.amrut-impact-section.update',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
