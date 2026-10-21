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
  imports: 'Student Import',
  registrations: 'Student Registration',
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
  'cms-contact': 'Contact Page Management',
  'cms-footer': 'Footer Management',
  'cms-modules': 'Modules Page Management',
  'cms-home': 'Home Page Figures',
  'cms-highlight': 'Home Programme Section',
  'cms-programme': 'Programme Page Management',
  'cms-faqs': 'FAQ Management',
  'cms-eligibility': 'Eligibility Page Management',
  'cms-states': 'State Master',
  'cms-districts': 'District Master',
  'cms-talukas': 'Taluka Master',
  'cms-departments': 'Department Master',
  'cms-colleges': 'College Master',
  'cms-documents': 'Document Master',
  'cms-batches': 'Batch Master',
  'cms-batch-assignments': 'Assign Batch',
  'cms-centre-types': 'Training Centre Type Master',
  'cms-training-centres': 'Training Centre Master',
  'cms-centre-locations': 'Location Information',
  'cms-centre-infrastructure': 'Capacity & Infrastructure',
  'lms-reference': 'Reference Data',
  'lms-entities': 'Entity Master',
  'lms-branding': 'Branding & Settings',
  'lms-calendars': 'Academic Calendar',
  'lms-learning-config': 'Learning Configuration',
  'lms-form-fields': 'Form Field Configuration',
  'lms-courses': 'Course Master',
  'lms-course-modules': 'Module Master',
  'lms-track-variants': 'Track Variant Master',
  admin: 'Administration',
  audit: 'Audit Log',
  settings: 'System Settings',
} as const;
export type MenuKey = keyof typeof MENUS;

/* Menus whose visibility can be toggled per role: every gated menu plus Users & Roles and Masters. */
/* Each master has its own sidebar item; keys equal the master permission prefixes. */
export const VISIBILITY_MENUS: string[] = [...Object.keys(MENUS), 'users', 'regions', 'castes', 'document-types', 'education'];

const def = (code: string, name: string, description: string): PermissionDefinition => ({
  code,
  name,
  module: code.split('.')[0],
  description,
});

export const MENU_PERMISSIONS: PermissionDefinition[] = (Object.keys(MENUS) as MenuKey[]).flatMap((menu) =>
  MENU_ACTIONS.map((action) =>
    def(`${menu}.${action}`, `${ACTION_LABEL[action]} ${MENUS[menu]}`, `${ACTION_LABEL[action]} in the ${MENUS[menu]} menu`),
  ),
);

/*
 * Reference-data masters (src/modules/masters): view, create, update, status (activate / deactivate) and delete.
 * Kept in step with MASTERS in the masters module (module code = its permission prefix).
 */
const MASTER_MODULES = { regions: 'Regions', castes: 'Castes', 'document-types': 'Document Types', education: 'Education' } as const;
const MASTER_ACTION_LABEL = { view: 'View', create: 'Add', update: 'Update', status: 'Activate / deactivate', delete: 'Delete' } as const;
export const MASTER_PERMISSIONS: PermissionDefinition[] = Object.entries(MASTER_MODULES).flatMap(([module, label]) =>
  Object.entries(MASTER_ACTION_LABEL).map(([action, verb]) =>
    def(`${module}.${action}`, `${verb} ${label}`, `${verb} records in the ${label} master`),
  ),
);

/* Extra codes beyond the five standard actions. */
const EXTRA_PERMISSIONS: PermissionDefinition[] = [def('reports.export', 'Export reports', 'Export reports and the MIS pack')];

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

  /*
   * CMS geography masters. These are the same codes MENU_PERMISSIONS generates for the three CMS
   * sidebar keys (and carry the same names, so re-seeding never rewrites them) — named here only so
   * the route guards can reference them through P instead of a bare string. `approve` is not used by
   * these screens, and restoring a soft-deleted record is guarded by the matching `.delete` code.
   */
  CMS_CONTACT_VIEW: def('cms-contact.view', 'View Contact Page Management', 'View in the Contact Page Management menu'),
  CMS_CONTACT_UPDATE: def('cms-contact.update', 'Update Contact Page Management', 'Update in the Contact Page Management menu'),
  CMS_FOOTER_VIEW: def('cms-footer.view', 'View Footer Management', 'View in the Footer Management menu'),
  CMS_FOOTER_UPDATE: def('cms-footer.update', 'Update Footer Management', 'Update in the Footer Management menu'),
  CMS_HIGHLIGHT_VIEW: def('cms-highlight.view', 'View Home Programme Section', 'View in the Home Programme Section menu'),
  CMS_HIGHLIGHT_UPDATE: def('cms-highlight.update', 'Update Home Programme Section', 'Update in the Home Programme Section menu'),
  CMS_HOME_VIEW: def('cms-home.view', 'View Home Page Figures', 'View in the Home Page Figures menu'),
  CMS_HOME_UPDATE: def('cms-home.update', 'Update Home Page Figures', 'Update in the Home Page Figures menu'),
  CMS_MODULES_VIEW: def('cms-modules.view', 'View Modules Page Management', 'View in the Modules Page Management menu'),
  CMS_MODULES_UPDATE: def('cms-modules.update', 'Update Modules Page Management', 'Update in the Modules Page Management menu'),
  CMS_PROGRAMME_VIEW: def('cms-programme.view', 'View Programme Page Management', 'View in the Programme Page Management menu'),
  CMS_PROGRAMME_UPDATE: def('cms-programme.update', 'Update Programme Page Management', 'Update in the Programme Page Management menu'),
  CMS_FAQS_VIEW: def('cms-faqs.view', 'View FAQ Management', 'View in the FAQ Management menu'),
  CMS_FAQS_CREATE: def('cms-faqs.create', 'Add FAQ Management', 'Add in the FAQ Management menu'),
  CMS_FAQS_UPDATE: def('cms-faqs.update', 'Update FAQ Management', 'Update in the FAQ Management menu'),
  CMS_FAQS_DELETE: def('cms-faqs.delete', 'Delete FAQ Management', 'Delete in the FAQ Management menu'),
  CMS_ELIGIBILITY_VIEW: def('cms-eligibility.view', 'View Eligibility Page Management', 'View in the Eligibility Page Management menu'),
  CMS_ELIGIBILITY_CREATE: def('cms-eligibility.create', 'Add Eligibility Page Management', 'Add in the Eligibility Page Management menu'),
  CMS_ELIGIBILITY_UPDATE: def('cms-eligibility.update', 'Update Eligibility Page Management', 'Update in the Eligibility Page Management menu'),
  CMS_ELIGIBILITY_DELETE: def('cms-eligibility.delete', 'Delete Eligibility Page Management', 'Delete in the Eligibility Page Management menu'),
  CMS_STATES_VIEW: def('cms-states.view', 'View State Master', 'View in the State Master menu'),
  CMS_STATES_CREATE: def('cms-states.create', 'Add State Master', 'Add in the State Master menu'),
  CMS_STATES_UPDATE: def('cms-states.update', 'Update State Master', 'Update in the State Master menu'),
  CMS_STATES_DELETE: def('cms-states.delete', 'Delete State Master', 'Delete in the State Master menu'),
  CMS_DISTRICTS_VIEW: def('cms-districts.view', 'View District Master', 'View in the District Master menu'),
  CMS_DISTRICTS_CREATE: def('cms-districts.create', 'Add District Master', 'Add in the District Master menu'),
  CMS_DISTRICTS_UPDATE: def('cms-districts.update', 'Update District Master', 'Update in the District Master menu'),
  CMS_DISTRICTS_DELETE: def('cms-districts.delete', 'Delete District Master', 'Delete in the District Master menu'),
  CMS_TALUKAS_VIEW: def('cms-talukas.view', 'View Taluka Master', 'View in the Taluka Master menu'),
  CMS_TALUKAS_CREATE: def('cms-talukas.create', 'Add Taluka Master', 'Add in the Taluka Master menu'),
  CMS_TALUKAS_UPDATE: def('cms-talukas.update', 'Update Taluka Master', 'Update in the Taluka Master menu'),
  CMS_TALUKAS_DELETE: def('cms-talukas.delete', 'Delete Taluka Master', 'Delete in the Taluka Master menu'),

  /* CMS masters (Masters sidebar group). Same codes and names as MENU_PERMISSIONS generates for these menus. */
  CMS_DEPARTMENTS_VIEW: def('cms-departments.view', 'View Department Master', 'View in the Department Master menu'),
  CMS_DEPARTMENTS_CREATE: def('cms-departments.create', 'Add Department Master', 'Add in the Department Master menu'),
  CMS_DEPARTMENTS_UPDATE: def('cms-departments.update', 'Update Department Master', 'Update in the Department Master menu'),
  CMS_DEPARTMENTS_DELETE: def('cms-departments.delete', 'Delete Department Master', 'Delete in the Department Master menu'),
  CMS_COLLEGES_VIEW: def('cms-colleges.view', 'View College Master', 'View in the College Master menu'),
  CMS_COLLEGES_CREATE: def('cms-colleges.create', 'Add College Master', 'Add in the College Master menu'),
  CMS_COLLEGES_UPDATE: def('cms-colleges.update', 'Update College Master', 'Update in the College Master menu'),
  CMS_COLLEGES_DELETE: def('cms-colleges.delete', 'Delete College Master', 'Delete in the College Master menu'),
  CMS_DOCUMENTS_VIEW: def('cms-documents.view', 'View Document Master', 'View in the Document Master menu'),
  CMS_DOCUMENTS_CREATE: def('cms-documents.create', 'Add Document Master', 'Add in the Document Master menu'),
  CMS_DOCUMENTS_UPDATE: def('cms-documents.update', 'Update Document Master', 'Update in the Document Master menu'),
  CMS_DOCUMENTS_DELETE: def('cms-documents.delete', 'Delete Document Master', 'Delete in the Document Master menu'),
  CMS_DOCUMENTS_APPROVE: def('cms-documents.approve', 'Approve Document Master', 'Approve in the Document Master menu'),
  CMS_BATCHES_VIEW: def('cms-batches.view', 'View Batch Master', 'View in the Batch Master menu'),
  CMS_BATCHES_CREATE: def('cms-batches.create', 'Add Batch Master', 'Add in the Batch Master menu'),
  CMS_BATCHES_UPDATE: def('cms-batches.update', 'Update Batch Master', 'Update in the Batch Master menu'),
  CMS_BATCHES_DELETE: def('cms-batches.delete', 'Delete Batch Master', 'Delete in the Batch Master menu'),
  CMS_BATCH_ASSIGNMENTS_VIEW: def('cms-batch-assignments.view', 'View Assign Batch', 'View in the Assign Batch menu'),
  CMS_BATCH_ASSIGNMENTS_CREATE: def('cms-batch-assignments.create', 'Add Assign Batch', 'Add in the Assign Batch menu'),
  CMS_BATCH_ASSIGNMENTS_UPDATE: def('cms-batch-assignments.update', 'Update Assign Batch', 'Update in the Assign Batch menu'),
  CMS_BATCH_ASSIGNMENTS_DELETE: def('cms-batch-assignments.delete', 'Delete Assign Batch', 'Delete in the Assign Batch menu'),
  CMS_CENTRE_TYPES_VIEW: def('cms-centre-types.view', 'View Training Centre Type Master', 'View in the Training Centre Type Master menu'),
  CMS_CENTRE_TYPES_CREATE: def('cms-centre-types.create', 'Add Training Centre Type Master', 'Add in the Training Centre Type Master menu'),
  CMS_CENTRE_TYPES_UPDATE: def('cms-centre-types.update', 'Update Training Centre Type Master', 'Update in the Training Centre Type Master menu'),
  CMS_CENTRE_TYPES_DELETE: def('cms-centre-types.delete', 'Delete Training Centre Type Master', 'Delete in the Training Centre Type Master menu'),
  CMS_TRAINING_CENTRES_VIEW: def('cms-training-centres.view', 'View Training Centre Master', 'View in the Training Centre Master menu'),
  CMS_TRAINING_CENTRES_CREATE: def('cms-training-centres.create', 'Add Training Centre Master', 'Add in the Training Centre Master menu'),
  CMS_TRAINING_CENTRES_UPDATE: def('cms-training-centres.update', 'Update Training Centre Master', 'Update in the Training Centre Master menu'),
  CMS_TRAINING_CENTRES_DELETE: def('cms-training-centres.delete', 'Delete Training Centre Master', 'Delete in the Training Centre Master menu'),
  CMS_CENTRE_LOCATIONS_VIEW: def('cms-centre-locations.view', 'View Location Information', 'View in the Location Information menu'),
  CMS_CENTRE_LOCATIONS_CREATE: def('cms-centre-locations.create', 'Add Location Information', 'Add in the Location Information menu'),
  CMS_CENTRE_LOCATIONS_UPDATE: def('cms-centre-locations.update', 'Update Location Information', 'Update in the Location Information menu'),
  CMS_CENTRE_LOCATIONS_DELETE: def('cms-centre-locations.delete', 'Delete Location Information', 'Delete in the Location Information menu'),
  CMS_CENTRE_INFRASTRUCTURE_VIEW: def('cms-centre-infrastructure.view', 'View Capacity & Infrastructure', 'View in the Capacity & Infrastructure menu'),
  CMS_CENTRE_INFRASTRUCTURE_CREATE: def('cms-centre-infrastructure.create', 'Add Capacity & Infrastructure', 'Add in the Capacity & Infrastructure menu'),
  CMS_CENTRE_INFRASTRUCTURE_UPDATE: def('cms-centre-infrastructure.update', 'Update Capacity & Infrastructure', 'Update in the Capacity & Infrastructure menu'),
  CMS_CENTRE_INFRASTRUCTURE_DELETE: def('cms-centre-infrastructure.delete', 'Delete Capacity & Infrastructure', 'Delete in the Capacity & Infrastructure menu'),

  /* LMS Admin masters (LMS Admin sidebar group). Same codes and names as MENU_PERMISSIONS generates for these menus. */
  LMS_REFERENCE_VIEW: def('lms-reference.view', 'View Reference Data', 'View in the Reference Data menu'),
  LMS_ENTITIES_VIEW: def('lms-entities.view', 'View Entity Master', 'View in the Entity Master menu'),
  LMS_ENTITIES_CREATE: def('lms-entities.create', 'Add Entity Master', 'Add in the Entity Master menu'),
  LMS_ENTITIES_UPDATE: def('lms-entities.update', 'Update Entity Master', 'Update in the Entity Master menu'),
  LMS_ENTITIES_DELETE: def('lms-entities.delete', 'Delete Entity Master', 'Delete in the Entity Master menu'),
  LMS_BRANDING_VIEW: def('lms-branding.view', 'View Branding & Settings', 'View in the Branding & Settings menu'),
  /*
   * L-04 splits the update right: "Update branding: entity.branding.update. Update settings: entity.update".
   * lms-branding.update covers the branding fields (F-LMS-04-01 to -03: display name, logo, colours);
   * lms-branding.update-settings the settings (F-LMS-04-04 to -07: support contacts, enabled languages).
   */
  LMS_BRANDING_UPDATE: def(
    'lms-branding.update',
    'Update Branding & Settings',
    'Update the display name, logo and colours in the Branding & Settings menu',
  ),
  LMS_BRANDING_UPDATE_SETTINGS: def(
    'lms-branding.update-settings',
    'Update support contacts & languages',
    'Update the support contacts and enabled languages in the Branding & Settings menu',
  ),
  LMS_CALENDARS_VIEW: def('lms-calendars.view', 'View Academic Calendar', 'View in the Academic Calendar menu'),
  LMS_CALENDARS_CREATE: def('lms-calendars.create', 'Add Academic Calendar', 'Add in the Academic Calendar menu'),
  LMS_CALENDARS_UPDATE: def('lms-calendars.update', 'Update Academic Calendar', 'Update in the Academic Calendar menu'),
  LMS_CALENDARS_DELETE: def('lms-calendars.delete', 'Delete Academic Calendar', 'Delete in the Academic Calendar menu'),
  /* L-05 / UI-313: config.learning.view / config.learning.update (6.1 "calendar / config"). */
  LMS_LEARNING_CONFIG_VIEW: def('lms-learning-config.view', 'View Learning Configuration', 'View in the Learning Configuration menu'),
  LMS_LEARNING_CONFIG_UPDATE: def('lms-learning-config.update', 'Update Learning Configuration', 'Update in the Learning Configuration menu'),
  LMS_FORM_FIELDS_VIEW: def('lms-form-fields.view', 'View Form Field Configuration', 'View in the Form Field Configuration menu'),
  LMS_FORM_FIELDS_CREATE: def('lms-form-fields.create', 'Add Form Field Configuration', 'Add in the Form Field Configuration menu'),
  LMS_FORM_FIELDS_UPDATE: def('lms-form-fields.update', 'Update Form Field Configuration', 'Update in the Form Field Configuration menu'),
  LMS_FORM_FIELDS_DELETE: def('lms-form-fields.delete', 'Delete Form Field Configuration', 'Delete in the Form Field Configuration menu'),
  LMS_COURSES_VIEW: def('lms-courses.view', 'View Course Master', 'View in the Course Master menu'),
  LMS_COURSES_CREATE: def('lms-courses.create', 'Add Course Master', 'Add in the Course Master menu'),
  LMS_COURSES_UPDATE: def('lms-courses.update', 'Update Course Master', 'Update in the Course Master menu'),
  LMS_COURSES_DELETE: def('lms-courses.delete', 'Delete Course Master', 'Delete in the Course Master menu'),
  LMS_COURSE_MODULES_VIEW: def('lms-course-modules.view', 'View Module Master', 'View in the Module Master menu'),
  LMS_COURSE_MODULES_CREATE: def('lms-course-modules.create', 'Add Module Master', 'Add in the Module Master menu'),
  LMS_COURSE_MODULES_UPDATE: def('lms-course-modules.update', 'Update Module Master', 'Update in the Module Master menu'),
  LMS_COURSE_MODULES_DELETE: def('lms-course-modules.delete', 'Delete Module Master', 'Delete in the Module Master menu'),
  LMS_TRACK_VARIANTS_VIEW: def('lms-track-variants.view', 'View Track Variant Master', 'View in the Track Variant Master menu'),
  LMS_TRACK_VARIANTS_CREATE: def('lms-track-variants.create', 'Add Track Variant Master', 'Add in the Track Variant Master menu'),
  LMS_TRACK_VARIANTS_UPDATE: def('lms-track-variants.update', 'Update Track Variant Master', 'Update in the Track Variant Master menu'),
  LMS_TRACK_VARIANTS_DELETE: def('lms-track-variants.delete', 'Delete Track Variant Master', 'Delete in the Track Variant Master menu'),
} as const satisfies Record<string, PermissionDefinition>;

/* The CMS sidebar keys, in menu order: website content, geography, then the Masters group. */
export const CMS_MENUS = [
  'cms-contact',
  'cms-footer',
  'cms-modules',
  'cms-programme',
  'cms-states',
  'cms-districts',
  'cms-talukas',
] as const satisfies readonly MenuKey[];

export type PermissionKey = keyof typeof PERMISSIONS;
export type PermissionCode = string;

/* Shorthand used by route guards: P.USERS_VIEW === 'users.view'. */
export const P = Object.fromEntries(Object.entries(PERMISSIONS).map(([k, v]) => [k, v.code])) as {
  [K in PermissionKey]: (typeof PERMISSIONS)[K]['code'];
};

/* Menu codes first; identity definitions win on duplicates (audit.view). */
export const ALL_PERMISSIONS: PermissionDefinition[] = [
  ...new Map(
    [...MENU_PERMISSIONS, ...EXTRA_PERMISSIONS, ...MASTER_PERMISSIONS, ...Object.values(PERMISSIONS)].map((p) => [p.code, p] as const),
  ).values(),
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
  /* Learning configuration and the branding settings had no codes of their own: roles keep what they could do. */
  'lms-calendars.view': { retire: false, to: menuCodes(['lms-learning-config'], ['view']) },
  'lms-calendars.update': { retire: false, to: menuCodes(['lms-learning-config'], ['update']) },
  'lms-branding.update': { retire: false, to: ['lms-branding.update-settings'] },
};
