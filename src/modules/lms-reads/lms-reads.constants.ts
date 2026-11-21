/*
 * Who may read which LMS data through the Panel (any one code of the list). Each read is guarded by the `.view` code
 * of the Panel screens it feeds (the existing menu permissions of admin-panel navConfig, see MENUS in
 * roles-permissions/permission.constants.ts), plus `lms.view` (LMS Integration), so no new permission code and no
 * migration is needed. The screens' own rights decide; the LMS key never reaches the browser.
 */
const LMS_INTEGRATION = 'lms.view';

export const LMS_READ_PERMISSIONS = {
  /* Dashboard, Executive Command, Today's Operations. */
  summary: ['dashboard.view', 'exec.view', 'today.view', LMS_INTEGRATION],
  /* Training Centres. */
  centres: ['centres.view', LMS_INTEGRATION],
  /* Batches. */
  batches: ['batches.view', LMS_INTEGRATION],
  /* Live Training Monitor, Offline Training, Online Training (class sessions and the live feed). */
  sessions: ['live.view', 'offline.view', 'online.view', LMS_INTEGRATION],
  /* Trainers, Trainer ToT. */
  trainers: ['trainers.view', 'tot.view', LMS_INTEGRATION],
  /* Attendance. */
  attendance: ['attendance.view', LMS_INTEGRATION],
} as const satisfies Record<string, readonly string[]>;

/* The switch probe (GET /lms-reads/status): anyone who may open one of the screens above. */
export const LMS_READ_ANY = [...new Set(Object.values(LMS_READ_PERMISSIONS).flat())];

/* The /tenant/v1 paths read, and the key scope each needs (lms-api docs/contracts/multi-tenant/tenant-api.md §2, §2b, §6). */
export const LMS_TENANT_READS = {
  summary: { path: '/summary', scope: 'stats.read' },
  centres: { path: '/centres', scope: 'stats.read' },
  batches: { path: '/batches', scope: 'stats.read' },
  sessions: { path: '/sessions', scope: 'stats.read' },
  trainers: { path: '/trainers', scope: 'stats.read' },
  attendance: { path: '/attendance', scope: 'delivery.read' },
  liveSessions: { path: '/live-sessions', scope: 'sessions.read' },
} as const;

export const LMS_READS_DISABLED = 'LMS_READS_DISABLED';
