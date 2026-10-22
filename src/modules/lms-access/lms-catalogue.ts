import { LMS_MENUS, LMS_PERMISSIONS } from './lms-catalogue.data';

/*
 * The LMS permission catalogue as the Admin Panel offers it on a role ("LMS menus"), kept apart from the Admin
 * Panel's own permission catalogue: these codes never grant anything in the Admin Panel, they are only handed to the
 * LMS when one of the role's users signs in there.
 */

/* LMS sidebar groups, in the LMS sidebar's order. */
export const LMS_GROUP_ORDER = [
  'Command Centre',
  'Access & Configuration',
  'Curriculum',
  'Delivery',
  'Assessment & Completion',
  'Engagement & Oversight',
  'Platform & Integration',
] as const;

/* LMS permission module → label and sidebar group. */
const AREAS: Record<string, { label: string; group: (typeof LMS_GROUP_ORDER)[number] }> = {
  dashboard: { label: 'Dashboard', group: 'Command Centre' },
  iam: { label: 'Users, roles & access', group: 'Access & Configuration' },
  entity: { label: 'Entity & branding', group: 'Access & Configuration' },
  calendar: { label: 'Academic calendar', group: 'Access & Configuration' },
  config: { label: 'Learning & security configuration', group: 'Access & Configuration' },
  'config.form': { label: 'Form field configuration', group: 'Access & Configuration' },
  reference: { label: 'Centre & track reference', group: 'Access & Configuration' },
  curriculum: { label: 'Courses, tracks & lessons', group: 'Curriculum' },
  resource: { label: 'Learning resources', group: 'Curriculum' },
  release: { label: 'Content releases', group: 'Curriculum' },
  batch: { label: 'Batches & schedule', group: 'Delivery' },
  session: { label: 'Class sessions', group: 'Delivery' },
  trainer: { label: 'Trainers', group: 'Delivery' },
  tot: { label: 'Trainer ToT', group: 'Delivery' },
  enrolment: { label: 'Enrolments & mapping', group: 'Delivery' },
  learner: { label: 'Learners', group: 'Delivery' },
  trackconfirmation: { label: 'Track confirmation', group: 'Delivery' },
  attendance: { label: 'Attendance', group: 'Delivery' },
  assessment: { label: 'Assessments, question banks & tasks', group: 'Assessment & Completion' },
  evaluation: { label: 'Evaluation', group: 'Assessment & Completion' },
  oft: { label: 'On Field Training', group: 'Assessment & Completion' },
  portfolio: { label: 'Portfolio', group: 'Assessment & Completion' },
  competency: { label: 'Competency bands', group: 'Assessment & Completion' },
  gate: { label: 'Readiness gates', group: 'Assessment & Completion' },
  completion: { label: 'Completion', group: 'Assessment & Completion' },
  certificate: { label: 'Certificates', group: 'Assessment & Completion' },
  notification: { label: 'Notifications', group: 'Engagement & Oversight' },
  support: { label: 'Student support', group: 'Engagement & Oversight' },
  trainingops: { label: 'Training operations', group: 'Engagement & Oversight' },
  atrisk: { label: 'At-risk learners', group: 'Engagement & Oversight' },
  engagement: { label: 'Engagement measures', group: 'Engagement & Oversight' },
  report: { label: 'Reports', group: 'Engagement & Oversight' },
  export: { label: 'Export requests', group: 'Engagement & Oversight' },
  audit: { label: 'Audit log & access review', group: 'Engagement & Oversight' },
  tools: { label: 'Import & export tools', group: 'Platform & Integration' },
  mobileconfig: { label: 'Learner app & web', group: 'Platform & Integration' },
  integration: { label: 'Integration monitoring', group: 'Platform & Integration' },
  privacy: { label: 'Retention & privacy', group: 'Platform & Integration' },
};

export const LMS_CODES: ReadonlySet<string> = new Set(LMS_PERMISSIONS.map((p) => p.code));

/*
 * Sensitive LMS codes (Table 21's sensitive column: user and role administration, approvals, releases, exports,
 * retention, the permission switch...). They are never granted from the Admin Panel: the LMS grants them only through
 * its own roles, where a reason and the segregation-of-duties checks apply (user decision, 22 Oct 2026).
 */
export const LMS_SENSITIVE_CODES: ReadonlySet<string> = new Set(LMS_PERMISSIONS.filter((p) => p.sensitive).map((p) => p.code));
/* The LMS codes an Admin Panel LMS role may carry. */
export const LMS_GRANTABLE_CODES: ReadonlySet<string> = new Set(LMS_PERMISSIONS.filter((p) => !p.sensitive).map((p) => p.code));

/* "iam.role.grant_sensitive" in area "iam" → "Role · grant sensitive". */
function actionLabel(code: string, area: string): string {
  /* A few codes sit in another module than their prefix (e.g. attempt.void in evaluation): keep the whole code then. */
  const rest = code.startsWith(`${area}.`) ? code.slice(area.length + 1) : code;
  const tail = rest.replace(/\./g, ' · ').replace(/_/g, ' ');
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}

export interface LmsCatalogueArea {
  area: string;
  label: string;
  /* LMS sidebar menus this area's codes open: holding any one of `view` shows the menu. */
  menus: { label: string; view: string[] }[];
  permissions: { code: string; label: string; sensitive: boolean; description: string }[];
}

export interface LmsCatalogueGroup {
  group: string;
  areas: LmsCatalogueArea[];
}

/* Grouped like the LMS sidebar; an area the map does not know yet goes to "Other" rather than being dropped. */
export function lmsCatalogue(): LmsCatalogueGroup[] {
  const byArea = new Map<string, LmsCatalogueArea>();
  for (const p of LMS_PERMISSIONS) {
    let a = byArea.get(p.area);
    if (!a) {
      a = { area: p.area, label: AREAS[p.area]?.label ?? p.area, menus: [], permissions: [] };
      byArea.set(p.area, a);
    }
    a.permissions.push({ code: p.code, label: actionLabel(p.code, p.area), sensitive: p.sensitive, description: p.description });
  }
  for (const a of byArea.values()) {
    const codes = new Set(a.permissions.map((p) => p.code));
    a.menus = LMS_MENUS.filter((m) => m.view.some((c) => codes.has(c))).map((m) => ({
      label: m.label,
      view: m.view.filter((c) => codes.has(c)),
    }));
  }
  const groups: string[] = [...LMS_GROUP_ORDER, 'Other'];
  return groups
    .map((group) => ({ group, areas: [...byArea.values()].filter((a) => (AREAS[a.area]?.group ?? 'Other') === group) }))
    .filter((g) => g.areas.length);
}
