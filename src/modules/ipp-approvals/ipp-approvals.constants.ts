import { P, ROLE_CODES } from '../roles-permissions';

/*
 * Approval of the student forms of IPP (docs/ipp-approvals.md). IPP = the 3 Month Internship Placement Program portal,
 * a separate project with its own database; the calls between the two servers are the contract
 * ipp_backend/docs/SARTHI_LINK.md.
 */
export const STAGES = ['AUDITOR', 'DIVISION', 'COEP', 'HEAD_OFFICE', 'SUPER_ADMIN', 'APPROVED'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Readonly<Record<Stage, string>> = {
  AUDITOR: 'With IPP Auditor',
  DIVISION: 'With Divisional Officer',
  COEP: 'With COEP',
  HEAD_OFFICE: 'With Head Office',
  SUPER_ADMIN: 'With Super Admin',
  APPROVED: 'Final approved',
};

/* How far along a stage is. HEAD_OFFICE and SUPER_ADMIN are the same (final) level: which of the two decides is the switch. */
export const STAGE_RANK: Readonly<Record<Stage, number>> = {
  AUDITOR: 0,
  DIVISION: 1,
  COEP: 2,
  HEAD_OFFICE: 3,
  SUPER_ADMIN: 3,
  APPROVED: 4,
};
export const FINAL_RANK = STAGE_RANK.HEAD_OFFICE;

/* The stages where an officer of Sarthi decides. */
export const LEVELS = ['DIVISION', 'COEP', 'HEAD_OFFICE', 'SUPER_ADMIN'] as const satisfies readonly Stage[];
export type Level = (typeof LEVELS)[number];
export const isLevel = (stage: string): stage is Level => (LEVELS as readonly string[]).includes(stage);

/* The office a decision is made for, as it is written in the history and sent to IPP. */
export const LEVEL_ROLES: Readonly<Record<Level, string>> = {
  DIVISION: 'Divisional Officer',
  COEP: 'COEP',
  HEAD_OFFICE: 'Head Officer',
  SUPER_ADMIN: 'Super Admin',
};
/* Who moved the waiting forms with the Head Office switch, when it is not a Super Admin. */
export const SWITCH_ROLE = 'Administrator';
export const IPP_ROLE = 'IPP Auditor';

export const EVENTS = ['RECEIVED', 'RESUBMITTED', 'CORRECTED', 'APPROVED', 'REJECTED', 'MOVED'] as const;
export type IppEvent = (typeof EVENTS)[number];
/* Events that move an application (everything but a correction). */
export type MoveEvent = Exclude<IppEvent, 'CORRECTED'>;

export const DECISION_ACTIONS = ['APPROVE', 'REJECT', 'MOVE'] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];
export const DECISION_STATUSES = ['PENDING', 'SENT', 'FAILED'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

/* Which permission gives which level. The Super Admin's level comes from the role (SUPER_ROLES), never from a permission. */
export const LEVEL_PERMISSIONS: readonly (readonly [string, Level])[] = [
  [P.IPP_APPROVALS_DIVISION_OFFICER, 'DIVISION'],
  [P.IPP_APPROVALS_COEP, 'COEP'],
  [P.IPP_APPROVALS_HEAD_OFFICE, 'HEAD_OFFICE'],
];
export const DECIDE_PERMISSIONS: readonly string[] = LEVEL_PERMISSIONS.map(([code]) => code);
/* These roles hold every permission: they read everything and decide only at SUPER_ADMIN. */
export const SUPER_ROLES: readonly string[] = [ROLE_CODES.SUPER_ADMIN, ROLE_CODES.SUMAGO_SUPER_ADMIN];

/* panel_settings key of the Head Office switch. No row = on. */
export const HEAD_OFFICE_KEY = 'ipp.head_office_approval';

export const BULK_MAX = 500;
export const REASON_MIN = 3;
export const REASON_MAX = 500;
export const OFFICER_DISTRICTS_MAX = 200;

export const IPP_ERROR = {
  LINK_UNAUTHORIZED: 'LINK_UNAUTHORIZED',
  LINK_NOT_CONFIGURED: 'LINK_NOT_CONFIGURED',
  APPLICATION_IN_OTHER_BATCH: 'APPLICATION_IN_OTHER_BATCH',
  STAGE_MISMATCH: 'STAGE_MISMATCH',
  APPLICATION_UNKNOWN: 'APPLICATION_UNKNOWN',
  DISTRICT_UNKNOWN: 'DISTRICT_UNKNOWN',
  NOT_YOURS_TO_DECIDE: 'NOT_YOURS_TO_DECIDE',
  NOT_A_DIVISIONAL_OFFICER: 'NOT_A_DIVISIONAL_OFFICER',
  IPP_UNAVAILABLE: 'IPP_UNAVAILABLE',
} as const;

export const IPP_AUDIT = {
  APPROVE: 'ipp.application.approve',
  APPROVE_MANY: 'ipp.application.approve-many',
  APPROVE_BATCH: 'ipp.batch.approve',
  REJECT: 'ipp.application.reject',
  DOCUMENT_VIEW: 'ipp.document.view',
  HEAD_OFFICE: 'ipp.head-office.update',
  OFFICER_DISTRICTS: 'ipp.officer.districts',
  LINK_RETRY: 'ipp.link.retry',
} as const;

/* Arbitrary constant keys of PostgreSQL advisory locks (lms-sync uses 727_274_001). */
export const OUTBOX_LOCK_KEY = 727_274_011;
/* Decisions hold this one shared, the Head Office switch holds it exclusive: nothing is approved into the stage being emptied. */
export const HEAD_OFFICE_LOCK_KEY = 727_274_012;

/* Decisions per call to IPP (contract section 3). */
export const SEND_MAX = 100;
/* Wait before try 2, 3, … of a decision IPP did not take (contract section 4); the last one repeats. */
export const BACKOFF_SECONDS = [30, 60, 120, 300, 600, 1_800, 3_600] as const;

/* Where an approval sends an application; `headOffice` = the switch "Head Office approval". */
export function approveTo(stage: Level, headOffice: boolean): Stage {
  switch (stage) {
    case 'DIVISION':
      return 'COEP';
    case 'COEP':
      return headOffice ? 'HEAD_OFFICE' : 'SUPER_ADMIN';
    default:
      return 'APPROVED';
  }
}

/* Where a rejection sends it: one level back. */
export function rejectTo(stage: Level): Stage {
  switch (stage) {
    case 'DIVISION':
      return 'AUDITOR';
    case 'COEP':
      return 'DIVISION';
    default:
      return 'COEP';
  }
}
