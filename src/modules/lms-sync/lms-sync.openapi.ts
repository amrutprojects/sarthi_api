import { z } from 'zod';
import { documentEndpoint, envelope, pagedEnvelope, registry } from '../../shared/openapi/registry';
import { SYNC_STATUSES } from './lms-sync.constants';
import { pushSchema, retrySchema, syncStudentSchema } from './lms-sync.validation';

/* OpenAPI of the M1 Amrut → LMS student sync admin endpoints (shapes also in docs/lms-sync/admin-api.md). */
const tag = 'LMS sync';
const view = ['imports.view', 'candidates.view'];
const act = 'imports.update';
const Flag = z.enum(SYNC_STATUSES);
const ts = z.string().datetime().nullable();
const ErrorDetail = z.object({ field: z.string().optional(), code: z.string() });

const SyncSummaryDto = registry.register(
  'LmsSyncSummary',
  z.object({
    tenantCode: z.string().nullable(),
    syncEnabled: z.boolean(),
    eligible: z.number().int().describe('Approved, active students (what the sync sends)'),
    byStatus: z.record(Flag, z.number().int()),
  }),
);

const SyncListItemDto = registry.register(
  'LmsSyncListItem',
  z.object({
    studentId: z.string().uuid(),
    code: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    centreCode: z.string().nullable(),
    trackCode: z.string().nullable(),
    studentStatus: z.string(),
    eligible: z.boolean(),
    syncStatus: Flag,
    lmsStatus: z.string().nullable(),
    lmsLearnerCode: z.string().nullable(),
    attempts: z.number().int(),
    lastErrorCode: z.string().nullable(),
    lastSentAt: ts,
    lastSyncedAt: ts,
    nextAttemptAt: ts,
  }),
);

const SyncDetailDto = registry.register(
  'LmsSyncDetail',
  z.object({
    studentId: z.string().uuid(),
    code: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    studentStatus: z.string(),
    eligible: z.boolean(),
    tenantCode: z.string().nullable(),
    syncEnabled: z.boolean(),
    syncStatus: Flag,
    lmsLearnerId: z.string().nullable(),
    lmsLearnerCode: z.string().nullable(),
    lmsRequestId: z.string().nullable(),
    lmsStatus: z.string().nullable(),
    lmsReasonCodes: z.array(z.string()),
    attempts: z.number().int(),
    lastErrorCode: z.string().nullable(),
    lastErrorDetails: z.array(ErrorDetail),
    queuedAt: ts,
    lastSentAt: ts,
    lastCheckedAt: ts,
    lastSyncedAt: ts,
    nextAttemptAt: ts,
    linkCreatedAt: ts,
    payload: z.object({
      fields: z.array(z.string()).describe('Field names the next send would carry (never values)'),
      missingRequiredFields: z.array(z.string()),
      checksum: z.string(),
      lastSentChecksum: z.string().nullable(),
      changedSinceLastSend: z.boolean(),
    }),
  }),
);

const PushResultDto = z.object({
  syncEnabled: z.boolean(),
  queued: z.array(z.string().uuid()),
  skipped: z.array(z.object({ studentId: z.string().uuid(), reason: z.enum(['NOT_FOUND', 'NOT_ELIGIBLE']) })),
});
const RetryResultDto = z.object({ syncEnabled: z.boolean(), queued: z.array(z.string().uuid()) });
const CycleStatsDto = z.object({
  ran: z.boolean(),
  reason: z.enum(['disabled', 'locked']).optional(),
  sent: z.number().int(),
  rejected: z.number().int(),
  failed: z.number().int(),
  deferred: z.number().int(),
  unchanged: z.number().int(),
  missingFields: z.number().int(),
  notEligible: z.number().int(),
  followed: z.number().int(),
  reconciled: z.number().int(),
  lmsUnavailable: z.boolean(),
  errorCode: z.string().optional(),
});

/* Documentation form of the list query (the validator also accepts a repeated syncStatus parameter). */
const listQueryDoc = z.object({
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  syncStatus: z
    .string()
    .optional()
    .describe(`One or more of ${SYNC_STATUSES.join(', ')}, comma-separated`),
  scope: z.enum(['eligible', 'all']).optional().describe('eligible (default) = approved, active students; all = every student'),
  search: z.string().max(100).optional().describe('Student code or name'),
  centre: z.string().max(10).optional(),
  errorCode: z.string().max(60).optional(),
});

documentEndpoint({
  method: 'get',
  path: '/lms-sync/summary',
  tag,
  summary: 'Sync flag counts over the eligible students',
  permission: view,
  response: envelope(SyncSummaryDto),
});
documentEndpoint({
  method: 'get',
  path: '/lms-sync/students',
  tag,
  summary: 'Students with their LMS sync flag (filterable)',
  permission: view,
  request: { query: listQueryDoc },
  response: pagedEnvelope(SyncListItemDto),
});
documentEndpoint({
  method: 'get',
  path: '/lms-sync/students/:id',
  tag,
  summary: 'One student’s LMS sync detail',
  permission: view,
  request: { params: syncStudentSchema.params },
  response: envelope(SyncDetailDto),
  errors: [404],
});
documentEndpoint({
  method: 'post',
  path: '/lms-sync/students/push',
  tag,
  summary: 'Push to LMS: queue one or many students now',
  description:
    'Eligible students become PENDING and are sent in the next cycle (started at once when the sync is on), even if unchanged. 409 LMS_TENANT_NOT_CONFIGURED while LMS_TENANT_CODE is not set.',
  permission: act,
  request: { body: pushSchema.body },
  response: envelope(PushResultDto),
  status: 200,
  errors: [409],
});
documentEndpoint({
  method: 'post',
  path: '/lms-sync/students/retry',
  tag,
  summary: 'Retry: queue failed students again',
  description: 'FAILED → PENDING for the given students, or for every failed student when studentIds is left out.',
  permission: act,
  request: { body: retrySchema.body },
  response: envelope(RetryResultDto),
  status: 200,
});
documentEndpoint({
  method: 'post',
  path: '/lms-sync/run',
  tag,
  summary: 'Run one sync cycle now',
  permission: act,
  response: envelope(CycleStatsDto),
  status: 200,
  errors: [409],
});
