/*
 * M1 Amrut → LMS student sync: the sync flag and how LMS intake statuses map onto it
 * (docs/lms-sync/README.md, LMS contract docs/contracts/multi-tenant/tenant-api.md).
 */
export const SYNC_STATUSES = ['NOT_SYNCED', 'PENDING', 'SENT', 'SYNCED', 'FAILED', 'REVIEW'] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];
export const SYNC_STATUS = Object.fromEntries(SYNC_STATUSES.map((s) => [s, s])) as { [K in SyncStatus]: K };

/* Intake statuses of GET /tenant/v1/students… (LMS StudentStatus.status). */
export const LMS_INTAKE_STATUSES = [
  'RECEIVED',
  'INVALID',
  'NOT_APPROVED',
  'DUPLICATE_SUSPECT',
  'PENDING_ALLOTMENT',
  'ALLOTTED',
  'PROVISIONED',
  'FAILED',
  'REJECTED',
  'WITHDRAWN',
  'ON_HOLD',
] as const;
export type LmsIntakeStatus = (typeof LMS_INTAKE_STATUSES)[number];

/*
 * LMS status → Amrut sync flag. PROVISIONED = the LMS learner exists (SYNCED). DUPLICATE_SUSPECT goes to REVIEW (the
 * same-person / different-person decision). Statuses that need a fix or ended the record are FAILED with the code
 * LMS_<status>. Everything else is still being processed by the LMS (SENT).
 */
export function flagForLmsStatus(status: string): SyncStatus {
  switch (status) {
    case 'PROVISIONED':
      return 'SYNCED';
    case 'DUPLICATE_SUSPECT':
      return 'REVIEW';
    case 'INVALID':
    case 'NOT_APPROVED':
    case 'FAILED':
    case 'REJECTED':
    case 'WITHDRAWN':
      return 'FAILED';
    default:
      return 'SENT';
  }
}

/* Error codes stored in student_lms_link.lastErrorCode (besides LMS_<status> and the LMS's own error codes). */
export const SYNC_ERROR = {
  /* A field the LMS requires is empty in Amrut; fixed by editing the student (the edit re-queues it). */
  MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS',
  /* The LMS answered 202 but listed the record in `rejected` (field codes in lastErrorDetails). */
  LMS_REJECTED_FIELDS: 'LMS_REJECTED_FIELDS',
  /* Network error, timeout, 429 or 5xx after the in-call retries: stays PENDING and is tried again later. */
  LMS_UNAVAILABLE: 'LMS_UNAVAILABLE',
  /* The student is no longer approved / active, or was deleted, when it was due to be sent. */
  NOT_ELIGIBLE: 'NOT_ELIGIBLE',
} as const;

/* Students the sync sends: approved and active (the register's "eligible" bucket), not deleted. */
export const ELIGIBLE_STUDENT_SQL = `s."isDelete" = false AND s."isActive" = true AND s."status" = 'RECEIVED'`;

/* lms_sync_state key of the reconciliation cursor of a tenant. */
export const reconcileCursorKey = (tenantCode: string) => `reconcile_cursor:${tenantCode}`;
