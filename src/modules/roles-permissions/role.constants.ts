/*
 * Initial roles. These mirror the 14 roles of the admin panel (admin-panel/src/legacy/data.js → ROLES),
 * expressed in the menu permission codes `<menu>.<view|create|update|delete|approve>`.
 * Seeding is idempotent: roles are matched by `code`; defaults are applied when a role is created.
 */
import { P, WEBSITE_MENUS, menuCodes, type MenuKey } from './permission.constants';

export interface RoleDefinition {
  code: string;
  name: string;
  description: string;
  /* System roles cannot be deleted, deactivated or re-coded through the API. */
  isSystem: boolean;
  /* 'ALL' grants every permission in the catalogue (kept in sync on every seed run). */
  permissions: string[] | 'ALL';
  /* With 'ALL': permission modules left out of the sync (e.g. 'registrations'); they can still be granted in the UI. */
  exceptModules?: string[];
}

/* ADMIN: an Admin Panel role (Admin Panel menus and permissions). LMS: an LMS role (LMS menus only). */
export const ROLE_PLATFORMS = ['ADMIN', 'LMS'] as const;
export type RolePlatform = (typeof ROLE_PLATFORMS)[number];

export const ROLE_CODES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  SUMAGO_SUPER_ADMIN: 'SUMAGO_SUPER_ADMIN',
  /* Public website content only: confined to WEBSITE_MENUS and never combined with another role (RbacService rules 6 and 7). */
  WEBSITE_ADMIN: 'WEBSITE_ADMIN',
} as const;

/* The website's singleton pages are viewed and edited; its list pages and the geography masters also add and delete. */
const WEBSITE_PAGES: MenuKey[] = ['cms-contact', 'cms-footer', 'cms-modules', 'cms-home', 'cms-highlight', 'cms-programme'];
const WEBSITE_LISTS: MenuKey[] = WEBSITE_MENUS.filter((m) => !WEBSITE_PAGES.includes(m));

const view = (...menus: MenuKey[]) => menuCodes(menus, ['view']);
const edit = (...menus: MenuKey[]) => menuCodes(menus, ['create', 'update']);
const approve = (...menus: MenuKey[]) => menuCodes(menus, ['approve']);

/* Every operational menu (the original `view.all`). */
const OPERATIONS: MenuKey[] = [
  'dashboard',
  'exec',
  'today',
  'candidates',
  'lifecycle',
  'atrisk',
  'districts',
  'map',
  'centres',
  'onboarding',
  'batches',
  'trainers',
  'tot',
  'live',
  'offline',
  'online',
  'attendance',
  'progress',
  'assessments',
  'certification',
  'marketing',
  'mobilization',
  'comms',
  'reports',
  'pmo',
  'qa',
  'tasks',
  'documents',
  'lms',
  'app',
];
const VIEW_ALL = view(...OPERATIONS);

/* Field roles see their own slice of operations. */
const FIELD_VIEW = view(
  'dashboard',
  'exec',
  'today',
  'candidates',
  'lifecycle',
  'atrisk',
  'batches',
  'live',
  'offline',
  'online',
  'attendance',
  'progress',
);

export const ROLES: RoleDefinition[] = [
  {
    code: ROLE_CODES.SUPER_ADMIN,
    name: 'Super Admin',
    isSystem: true,
    permissions: 'ALL',
    /* Student Registration is granted to SUMAGO Super Admin by default; any role can be given it in Roles & Permissions. */
    exceptModules: ['registrations'],
    description: 'Full system access, including users, roles and permissions',
  },
  {
    code: ROLE_CODES.SUMAGO_SUPER_ADMIN,
    name: 'SUMAGO Super Admin',
    isSystem: true,
    permissions: 'ALL',
    description: 'Every Super Admin permission plus Student Registration',
  },
  {
    code: ROLE_CODES.WEBSITE_ADMIN,
    name: 'Website Admin',
    isSystem: true,
    description: 'Public website content (the CMS menu) only; no programme data, masters or administration',
    permissions: [...menuCodes(WEBSITE_PAGES, ['view', 'update']), ...menuCodes(WEBSITE_LISTS, ['view', 'create', 'update', 'delete'])],
  },
  {
    code: 'AMRUT_ADMIN',
    name: 'AMRUT Admin',
    isSystem: false,
    description: 'State-level oversight, read and approve',
    permissions: [...VIEW_ALL, ...approve('centres', 'onboarding', 'certification', 'documents'), 'reports.export'],
  },
  {
    code: 'PROJECT_DIRECTOR',
    name: 'SUMAGO Project Director',
    isSystem: false,
    description: 'Full programme, finance visible, configuration',
    permissions: [
      ...VIEW_ALL,
      ...view('finance', 'admin', 'settings'),
      ...menuCodes(['admin', 'settings'], ['update']),
      'reports.export',
      P.AUDIT_VIEW,
      P.USERS_VIEW,
      P.ROLES_VIEW,
      P.PERMISSIONS_VIEW,
    ],
  },
  {
    code: 'PMO',
    name: 'SUMAGO PMO',
    isSystem: false,
    description: 'State-level operations',
    permissions: [...VIEW_ALL, ...edit('tasks', 'batches', 'attendance', 'assessments')],
  },
  {
    code: 'DISTRICT_COORD',
    name: 'District Coordinator',
    isSystem: false,
    description: 'Assigned districts and their centres',
    permissions: [
      ...FIELD_VIEW,
      ...view(
        'districts',
        'map',
        'centres',
        'onboarding',
        'trainers',
        'tot',
        'assessments',
        'certification',
        'tasks',
        'pmo',
        'documents',
        'comms',
      ),
      ...edit('tasks'),
      'comms.create',
    ],
  },
  {
    code: 'CENTRE_MANAGER',
    name: 'Centre Manager',
    isSystem: false,
    description: 'Own centre, batches and students',
    permissions: [
      ...FIELD_VIEW,
      ...view('centres', 'onboarding', 'trainers', 'tot', 'assessments', 'certification', 'documents'),
      ...edit('documents', 'attendance', 'batches'),
      'candidates.update',
    ],
  },
  {
    code: 'TRAINER',
    name: 'Trainer',
    isSystem: false,
    description: 'Assigned batches only',
    permissions: [...FIELD_VIEW, ...edit('attendance')],
  },
  {
    code: 'ONLINE_MANAGER',
    name: 'Online Training Manager',
    isSystem: false,
    description: 'Online mode, LMS and online batches',
    permissions: [...FIELD_VIEW, ...view('assessments', 'certification', 'lms', 'app'), 'lms.update', ...edit('batches', 'attendance')],
  },
  {
    code: 'MIS_MANAGER',
    name: 'MIS Manager',
    isSystem: false,
    description: 'Reports, exports and data quality',
    permissions: [...VIEW_ALL, 'reports.export'],
  },
  {
    code: 'QA_MANAGER',
    name: 'QA Manager',
    isSystem: false,
    description: 'Inspections and centre scoring',
    permissions: [...VIEW_ALL, ...edit('qa')],
  },
  {
    code: 'FINANCE_USER',
    name: 'Finance User',
    isSystem: false,
    description: 'Finance and payment milestones',
    permissions: [...view('dashboard', 'exec', 'today', 'finance'), ...edit('finance'), 'finance.approve'],
  },
  {
    code: 'MARKETING_USER',
    name: 'Marketing User',
    isSystem: false,
    description: 'Campaigns, leads and content',
    permissions: [
      ...view('dashboard', 'exec', 'today', 'candidates', 'lifecycle', 'atrisk', 'marketing', 'mobilization', 'comms'),
      ...menuCodes(['marketing'], ['create', 'update', 'delete']),
      'comms.create',
    ],
  },
  {
    code: 'HELPDESK',
    name: 'Helpdesk',
    isSystem: false,
    description: 'Candidate support and communications',
    permissions: [...view('dashboard', 'exec', 'today', 'candidates', 'lifecycle', 'atrisk', 'documents', 'comms'), 'comms.create'],
  },
  {
    code: 'IMPORT_OPERATOR',
    name: 'Candidate Data Import Operator',
    isSystem: false,
    description: 'Uploads approved-student files, resolves exceptions and cancels own batches',
    permissions: [...view('dashboard', 'imports'), ...menuCodes(['imports'], ['create', 'update', 'delete'])],
  },
  {
    code: 'IMPORT_REVIEWER',
    name: 'Candidate Data Reviewer',
    isSystem: false,
    description: 'Reviews exceptions and duplicates, and finalises batches uploaded by others',
    permissions: [...view('dashboard', 'imports'), ...menuCodes(['imports'], ['update', 'approve'])],
  },
  {
    code: 'VIEWER',
    name: 'Read-only Viewer',
    isSystem: false,
    description: 'Read-only dashboards',
    permissions: VIEW_ALL,
  },
];
