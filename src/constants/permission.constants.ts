/*
 * Permission catalogue. Every admin panel menu (admin-panel/src/routes/navConfig.ts, keyed by its
 * sidebar key) has the five standard actions `<menu>.view|create|update|delete|approve`. Identity &
 * access keeps its own finer codes, which the API routes are guarded with. The database is the source
 * of truth at runtime; this list is what the seed script upserts.
 */

export interface PermissionDefinition {
  code: string;
  name: string;
  module: string;
  description: string;
}

export const MENU_ACTIONS = ['view', 'create', 'update', 'delete', 'approve'] as const;
export type MenuAction = (typeof MENU_ACTIONS)[number];

const ACTION_LABEL: Record<MenuAction, string> = { view: 'View', create: 'Add', update: 'Update', delete: 'Delete', approve: 'Approve' };

/* Sidebar key → menu label. Public pages (site, certificate verification) are not permission-gated. */
export const MENUS = {
  dashboard: 'Dashboard',
  exec: 'Executive Command',
  today: "Today's Operations",
  candidates: 'Candidates',
  lifecycle: 'Lifecycle & Funnel',
  atrisk: 'At-Risk Engine',
  districts: 'Districts',
  map: 'District Map',
  centres: 'Training Centres',
  onboarding: 'Centre Onboarding',
  batches: 'Batches',
  trainers: 'Trainers',
  tot: 'Trainer ToT',
  live: 'Live Training Monitor',
  offline: 'Offline Training',
  online: 'Online Training',
  attendance: 'Attendance',
  progress: 'Student Progress',
  assessments: 'Assessments',
  certification: 'Certification',
  marketing: 'Marketing',
  mobilization: 'Mobilization',
  comms: 'Communications',
  reports: 'Reports & MIS',
  finance: 'Finance',
  pmo: 'PMO Dashboard',
  qa: 'Quality Assurance',
  tasks: 'Tasks & Alerts',
  documents: 'Documents',
  lms: 'LMS Integration',
  app: 'Student App',
  admin: 'Administration',
  audit: 'Audit Log',
  settings: 'System Settings',
} as const;
export type MenuKey = keyof typeof MENUS;

/* Menus whose visibility can be toggled per role: every gated menu plus Users & Roles. */
export const VISIBILITY_MENUS: string[] = [...Object.keys(MENUS), 'users'];

const def = (code: string, name: string, description: string): PermissionDefinition => ({
  code,
  name,
  module: code.split('.')[0],
  description,
});

export const MENU_PERMISSIONS: PermissionDefinition[] = (Object.keys(MENUS) as MenuKey[]).flatMap((menu) =>
  MENU_ACTIONS.map((action) => def(`${menu}.${action}`, `${ACTION_LABEL[action]} ${MENUS[menu]}`, `${ACTION_LABEL[action]} in the ${MENUS[menu]} menu`)));

/* Extra codes beyond the five standard actions. */
const EXTRA_PERMISSIONS: PermissionDefinition[] = [
  def('reports.export', 'Export reports', 'Export reports and the MIS pack'),
];

export const PERMISSIONS = {
  /* Identity & access */
  USERS_VIEW: def('users.view', 'View users', 'List and view user accounts'),
  USERS_CREATE: def('users.create', 'Create users', 'Create user accounts'),
  USERS_UPDATE: def('users.update', 'Update users', 'Edit, activate and deactivate user accounts'),
  USERS_DELETE: def('users.delete', 'Delete users', 'Soft-delete user accounts'),
  USERS_RESTORE: def('users.restore', 'Restore users', 'Restore soft-deleted user accounts'),
  USERS_ASSIGN_ROLES: def('users.assign-roles', 'Assign roles to users', 'Change which roles a user holds'),
  ROLES_VIEW: def('roles.view', 'View roles', 'List and view roles'),
  ROLES_CREATE: def('roles.create', 'Create roles', 'Create roles'),
  ROLES_UPDATE: def('roles.update', 'Update roles', 'Edit, activate and deactivate roles, and set menu visibility'),
  ROLES_DELETE: def('roles.delete', 'Delete roles', 'Soft-delete roles'),
  ROLES_RESTORE: def('roles.restore', 'Restore roles', 'Restore soft-deleted roles'),
  PERMISSIONS_VIEW: def('permissions.view', 'View permissions', 'List and view permissions'),
  PERMISSIONS_CREATE: def('permissions.create', 'Create permissions', 'Create permissions'),
  PERMISSIONS_UPDATE: def('permissions.update', 'Update permissions', 'Edit, activate and deactivate permissions'),
  PERMISSIONS_DELETE: def('permissions.delete', 'Delete permissions', 'Soft-delete permissions'),
  PERMISSIONS_RESTORE: def('permissions.restore', 'Restore permissions', 'Restore soft-deleted permissions'),
  PERMISSIONS_ASSIGN: def('permissions.assign', 'Assign permissions to roles', 'Change which permissions a role grants'),
  AUDIT_VIEW: def('audit.view', 'View Audit Log', 'View in the Audit Log menu'),
} as const satisfies Record<string, PermissionDefinition>;

export type PermissionKey = keyof typeof PERMISSIONS;
export type PermissionCode = string;

/* Shorthand used by route guards: P.USERS_VIEW === 'users.view'. */
export const P = Object.fromEntries(Object.entries(PERMISSIONS).map(([k, v]) => [k, v.code])) as {
  [K in PermissionKey]: (typeof PERMISSIONS)[K]['code'];
};

/* Menu codes first; identity definitions win on duplicates (audit.view). */
export const ALL_PERMISSIONS: PermissionDefinition[] = [
  ...new Map([...MENU_PERMISSIONS, ...EXTRA_PERMISSIONS, ...Object.values(PERMISSIONS)].map((p) => [p.code, p] as const)).values(),
];

/* Builder for role defaults. */
export const menuCodes = (menus: MenuKey[], actions: readonly MenuAction[] = MENU_ACTIONS): string[] =>
  menus.flatMap((m) => actions.map((a) => `${m}.${a}`));

/*
 * Codes from the earlier catalogue → their replacements. On a seed run, a role holding a retired code is
 * granted its replacements and the retired permission is soft-deleted; a role holding a kept code is
 * granted those replacements that the same run newly created. Both happen once, so later edits stick.
 */
export const LEGACY_CODE_MAP: Record<string, { retire: boolean; to: string[] }> = {
  'dashboard.view': { retire: false, to: menuCodes(['exec', 'today'], ['view']) },
  'candidates.view': { retire: false, to: menuCodes(['lifecycle', 'atrisk'], ['view']) },
  'districts.view': { retire: false, to: menuCodes(['map'], ['view']) },
  'centres.view': { retire: false, to: menuCodes(['onboarding'], ['view']) },
  'centres.manage': { retire: true, to: menuCodes(['centres', 'onboarding'], ['create', 'update', 'approve']) },
  'batches.manage': { retire: true, to: menuCodes(['batches'], ['create', 'update']) },
  'trainers.view': { retire: false, to: menuCodes(['tot'], ['view']) },
  'trainers.manage': { retire: true, to: menuCodes(['trainers'], ['create', 'update']) },
  'training.view': { retire: true, to: menuCodes(['live', 'offline', 'online', 'progress'], ['view']) },
  'attendance.mark': { retire: true, to: menuCodes(['attendance'], ['create', 'update']) },
  'assessments.manage': { retire: true, to: menuCodes(['assessments'], ['create', 'update']) },
  'certification.issue': { retire: true, to: menuCodes(['certification'], ['create', 'approve']) },
  'marketing.view': { retire: false, to: menuCodes(['mobilization'], ['view']) },
  'marketing.manage': { retire: true, to: menuCodes(['marketing'], ['create', 'update', 'delete']) },
  'communications.view': { retire: true, to: menuCodes(['comms'], ['view']) },
  'communications.send': { retire: true, to: menuCodes(['comms'], ['view', 'create']) },
  'finance.manage': { retire: true, to: menuCodes(['finance'], ['create', 'update', 'approve']) },
  'qa.manage': { retire: true, to: menuCodes(['qa'], ['create', 'update']) },
  'tasks.view': { retire: false, to: menuCodes(['pmo'], ['view']) },
  'tasks.manage': { retire: true, to: menuCodes(['tasks'], ['create', 'update']) },
  'documents.manage': { retire: true, to: menuCodes(['documents'], ['create', 'update', 'approve']) },
  'lms.view': { retire: false, to: menuCodes(['app'], ['view']) },
  'lms.manage': { retire: true, to: menuCodes(['lms'], ['update']) },
  'settings.view': { retire: false, to: menuCodes(['admin'], ['view']) },
  'settings.update': { retire: false, to: menuCodes(['admin'], ['update']) },
};
