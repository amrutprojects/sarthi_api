import { z } from 'zod';
import { documentEndpoint, envelope, pagedEnvelope, registry } from '../../shared/openapi/registry';
import { LIVE_DATA_SETTING_PERMISSIONS as S, LMS_READ_ANY, LMS_READ_PERMISSIONS as P } from './lms-reads.constants';
import { liveDataBody, lmsAttendanceQuery, lmsListQuery, lmsLiveSessionsQuery, lmsSummaryQuery } from './lms-reads.validation';

const tag = 'LMS reads';
const ts = z.string().nullable().describe('ISO 8601 instant from the LMS');
const counts = z.record(z.unknown()).describe('Counts as the LMS sends them, keys in camelCase');
const SOURCE =
  'Read live from the LMS tenant API (`/tenant/v1`) with the Amrut tenant key; reused for `LMS_READS_CACHE_SECONDS`. ' +
  'Headers `X-Lms-Fetched-At` and `X-Lms-Cache` (HIT / MISS / REVALIDATED). 404 `LMS_READS_DISABLED` while LMS_READS_ENABLED is off; ' +
  '503 `LMS_TIMEOUT` / `LMS_UNREACHABLE` / `LMS_UNAVAILABLE` / `LMS_RATE_LIMITED` / `LMS_KEY_REJECTED` / `LMS_BAD_ANSWER` when the LMS cannot be used. ' +
  'G-2: 404 `LMS_LIVE_DATA_OFF` while the master switch is on but the setting "Show live LMS data" is off. The envelope carries ' +
  '`source: "live"` and `fetched_at`; these routes never fall back to local data.';

/* G-2: every data answer says where it came from. */
const LIVE = { source: z.literal('live'), fetched_at: z.string().describe('ISO 8601 instant the LMS produced the answer') };
const liveEnvelope = <T extends z.ZodTypeAny>(data: T) => envelope(data).extend(LIVE);
const livePagedEnvelope = <T extends z.ZodTypeAny>(item: T) => pagedEnvelope(item).extend(LIVE);

export const LiveDataStateDto = registry.register(
  'LmsLiveDataState',
  z.object({
    setting: z.boolean().describe('What an administrator chose (default false)'),
    masterSwitch: z.boolean().describe('LMS_READS_ENABLED'),
    configured: z.boolean().describe('LMS API host, tenant key and tenant code are entered'),
    canEnable: z.boolean(),
    blocker: z.enum(['MASTER_SWITCH_OFF', 'LMS_NOT_CONFIGURED']).nullable(),
    missing: z.array(z.string()).describe('Names of the missing link variables, never values'),
    live: z.boolean().describe('setting && masterSwitch && configured'),
    source: z.enum(['live', 'local']),
    updatedAt: z.string().nullable(),
    updatedByUserId: z.string().nullable(),
  }),
);

export const LmsReadsStatusDto = registry.register(
  'LmsReadsStatus',
  z.object({ enabled: z.boolean(), configured: z.boolean(), cacheSeconds: z.number().int(), timeoutMs: z.number().int() }),
);
const CodeName = z.object({ code: z.string(), name: z.string() });
export const LmsSummaryDto = registry.register(
  'LmsSummary',
  z.object({
    tenant: CodeName.nullable(),
    entity: CodeName.nullable(),
    entities: z.array(CodeName),
    generatedAt: ts,
    learners: counts,
    batches: counts,
    centresActive: z.number().int(),
    trainersActive: z.number().int(),
    attendance: z.object({
      sessionsScheduled: z.number().int(),
      recordsMarked: z.number().int(),
      attended: z.number().int(),
      attendancePercent: z.number().nullable(),
    }),
    outcomes: counts,
    byCentre: z.array(counts),
    byTrack: z.array(counts),
    byBatch: z.array(counts),
  }),
);
export const LmsCentreDto = registry.register(
  'LmsCentre',
  z.object({
    code: z.string(),
    name: z.string(),
    districtCode: z.string().nullable(),
    districtName: z.string().nullable(),
    centreTypeName: z.string().nullable(),
    status: z.string(),
    isActive: z.boolean(),
    sourceUpdatedAt: ts,
  }),
);
export const LmsBatchDto = registry.register(
  'LmsBatch',
  z.object({
    id: z.string(),
    code: z.string(),
    entityCode: z.string(),
    courseCode: z.string(),
    centreCode: z.string(),
    centreName: z.string(),
    trackCode: z.string().nullable(),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    deliveryMode: z.string().nullable(),
    status: z.string(),
    capacity: z.number().int().nullable(),
    learnersEnrolled: z.number().int(),
    learnersActive: z.number().int(),
    learnersCompleted: z.number().int(),
    learnersWithdrawn: z.number().int(),
    updatedAt: ts,
  }),
);
export const LmsSessionDto = registry.register(
  'LmsSession',
  z.object({
    id: z.string(),
    batchCode: z.string(),
    centreCode: z.string(),
    entityCode: z.string(),
    title: z.string().nullable(),
    moduleNo: z.number().int().nullable(),
    startsAt: ts,
    endsAt: ts,
    deliveryMode: z.string().nullable(),
    attendanceMode: z.string().nullable(),
    status: z.string(),
    trainerCode: z.string().nullable(),
    attendance: z.object({ present: z.number().int(), late: z.number().int(), absent: z.number().int(), excused: z.number().int() }),
    updatedAt: ts,
  }),
);
export const LmsLiveSessionsDto = registry.register(
  'LmsLiveSessions',
  z.object({
    asOf: ts,
    date: z.string().nullable(),
    items: z.array(
      z.object({
        id: z.string(),
        batchCode: z.string(),
        centreCode: z.string(),
        deliveryMode: z.string().nullable(),
        trainerCode: z.string().nullable(),
        trainerName: z.string().nullable(),
        topic: z.string().nullable(),
        startsAt: ts,
        endsAt: ts,
        status: z.string(),
        inProgress: z.boolean(),
        enrolled: z.number().int(),
        present: z.number().int(),
        late: z.number().int(),
      }),
    ),
  }),
);
export const LmsTrainerDto = registry.register(
  'LmsTrainer',
  z.object({
    id: z.string(),
    code: z.string(),
    displayName: z.string(),
    status: z.string(),
    entityCode: z.string(),
    centreCodes: z.array(z.string()),
    batchCodes: z.array(z.string()),
    updatedAt: ts,
  }),
);
export const LmsAttendanceDto = registry.register(
  'LmsAttendance',
  z.object({
    groupBy: z.string(),
    dateFrom: z.string().nullable(),
    dateTo: z.string().nullable(),
    items: z.array(
      z.object({
        code: z.string(),
        batches: z.number().int(),
        sessionsHeld: z.number().int(),
        present: z.number().int(),
        late: z.number().int(),
        absent: z.number().int(),
        excused: z.number().int(),
        selfCheckIns: z.number().int(),
        geoCheckIns: z.number().int(),
        selfies: z.number().int(),
        groupPhotos: z.number().int(),
      }),
    ),
  }),
);

documentEndpoint({
  method: 'get',
  path: '/lms-reads/status',
  tag,
  summary: 'Whether the Panel reads its LMS data from the LMS',
  description: 'Feature probe for the screens: `enabled` mirrors LMS_READS_ENABLED. Never calls the LMS and never returns the key or URL.',
  permission: [...LMS_READ_ANY],
  response: envelope(LmsReadsStatusDto),
});

const data = [
  {
    path: '/lms-reads/summary',
    summary: 'LMS counts for Amrut (or one entity)',
    lms: '`GET /tenant/v1/summary` (scope stats.read)',
    permission: P.summary,
    query: lmsSummaryQuery,
    response: liveEnvelope(LmsSummaryDto),
  },
  {
    path: '/lms-reads/centres',
    summary: 'Centres Amrut’s LMS entities use',
    lms: '`GET /tenant/v1/centres` (scope stats.read)',
    permission: P.centres,
    query: lmsListQuery,
    response: livePagedEnvelope(LmsCentreDto),
  },
  {
    path: '/lms-reads/batches',
    summary: 'LMS batches with learner counts',
    lms: '`GET /tenant/v1/batches` (scope stats.read)',
    permission: P.batches,
    query: lmsListQuery,
    response: livePagedEnvelope(LmsBatchDto),
  },
  {
    path: '/lms-reads/sessions',
    summary: 'LMS class sessions with attendance counts',
    lms: '`GET /tenant/v1/sessions` (scope stats.read)',
    permission: P.sessions,
    query: lmsListQuery,
    response: livePagedEnvelope(LmsSessionDto),
  },
  {
    path: '/lms-reads/live-sessions',
    summary: 'LMS class sessions of one day (live monitor)',
    lms: '`GET /tenant/v1/live-sessions` (API-110, scope sessions.read)',
    permission: P.sessions,
    query: lmsLiveSessionsQuery,
    response: liveEnvelope(LmsLiveSessionsDto),
  },
  {
    path: '/lms-reads/trainers',
    summary: 'LMS trainers with centre and batch assignments',
    lms: '`GET /tenant/v1/trainers` (scope stats.read)',
    permission: P.trainers,
    query: lmsListQuery,
    response: livePagedEnvelope(LmsTrainerDto),
  },
  {
    path: '/lms-reads/attendance',
    summary: 'LMS attendance counts per district, division, centre or batch',
    lms: '`GET /tenant/v1/attendance` (scope delivery.read)',
    permission: P.attendance,
    query: lmsAttendanceQuery,
    response: liveEnvelope(LmsAttendanceDto),
  },
] as const;

for (const d of data)
  documentEndpoint({
    method: 'get',
    path: d.path,
    tag,
    summary: d.summary,
    description: `Source: ${d.lms}. ${SOURCE}`,
    permission: [...d.permission],
    request: { query: d.query },
    response: d.response,
    errors: [404, 503],
  });

documentEndpoint({
  method: 'get',
  path: '/lms-reads/live-data',
  tag,
  summary: 'G-2 setting "Show live LMS data"',
  description:
    'The switch state: the stored setting (default off), the master switch LMS_READS_ENABLED, whether the LMS link is configured, ' +
    'whether the switch may be turned on (and why not), and the effective `source` the screens show (`live` / `local`). Never returns key or URL.',
  permission: [...S.view],
  response: envelope(LiveDataStateDto),
});

documentEndpoint({
  method: 'put',
  path: '/lms-reads/live-data',
  tag,
  summary: 'Switch "Show live LMS data" on or off (audited)',
  description:
    'Switching on needs the master switch LMS_READS_ENABLED and the LMS link configured (host, tenant key, tenant code): otherwise 409 ' +
    '`LMS_LIVE_DATA_UNAVAILABLE` with the blocker and the missing variable names. Switching off is always allowed. Audit action `lms.live_data.update`.',
  permission: [...S.update],
  request: { body: liveDataBody },
  response: envelope(LiveDataStateDto),
  errors: [409, 422],
});
