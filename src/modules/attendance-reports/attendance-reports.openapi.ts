import { z } from 'zod';
import { documentEndpoint, envelope, registry } from '../../shared/openapi/registry';
import { ATTENDANCE_REPORT_PERMISSIONS } from './attendance-reports.constants';
import { attendanceReportQuery } from './attendance-reports.validation';

const tag = 'Attendance reports';
const int = z.number().int();
const pct = z.number().nullable().describe('Share of `marked`, one decimal; null when nothing was marked');
const Place = z.object({ code: z.string(), name: z.string(), nameMr: z.string().nullable() });
const counts = {
  batches: int,
  sessionsHeld: int,
  present: int,
  late: int,
  absent: int,
  excused: int,
  marked: int.describe('present + late + absent + excused'),
  selfCheckIns: int,
  geoCheckIns: int,
  selfies: int,
  groupPhotos: int,
  presentPercent: pct,
  latePercent: pct,
  absentPercent: pct,
  excusedPercent: pct,
  attendancePercent: pct.describe('(present + late) / marked'),
};

export const AttendanceReportsStatusDto = registry.register(
  'AttendanceReportsStatus',
  z.object({
    enabled: z.boolean().describe('LMS_READS_ENABLED (server master switch)'),
    configured: z.boolean(),
    liveData: z.boolean().describe('Panel setting "Show live LMS data"'),
    live: z.boolean().describe('enabled && liveData && configured: reports can be read now'),
    cacheSeconds: int,
    timeoutMs: int,
  }),
);

export const AttendanceReportDto = registry.register(
  'AttendanceReport',
  z.object({
    level: z.enum(['division', 'district', 'centre', 'batch']),
    dateFrom: z.string().nullable(),
    dateTo: z.string().nullable(),
    fetchedAt: z.string().describe('When the LMS produced the counts'),
    filters: z.object({ division: Place.nullable(), district: Place.nullable(), centre: Place.nullable() }),
    rows: z.array(
      z.object({
        code: z.string(),
        name: z.string(),
        nameMr: z.string().nullable(),
        mapped: z.boolean().describe('false when Amrut’s masters do not know the LMS code'),
        division: Place.nullable(),
        district: Place.nullable(),
        centre: Place.nullable(),
        ...counts,
      }),
    ),
    totals: z.object(counts),
    unplaced: int.describe('LMS rows a filter could not place (parent unknown to Amrut); not in rows or totals'),
  }),
);

documentEndpoint({
  method: 'get',
  path: '/attendance-reports/status',
  tag,
  summary: 'Whether attendance reports can be read from the LMS now',
  description:
    'Mirrors the M1 LMS read switch, the "Show live LMS data" setting and the link configuration. Never calls the LMS and never returns the key or URL.',
  permission: [...ATTENDANCE_REPORT_PERMISSIONS],
  response: envelope(AttendanceReportsStatusDto),
});

documentEndpoint({
  method: 'get',
  path: '/attendance-reports',
  tag,
  summary: 'Attendance by division, district, centre or batch (M3)',
  description:
    'Source: `GET /tenant/v1/attendance` (scope delivery.read; batch level also `GET /tenant/v1/batches`, scope stats.read) ' +
    'through the M1 read client, reused for `LMS_READS_CACHE_SECONDS`. LMS codes are named from Amrut’s District and ' +
    'Training Centre masters; divisions from the Maharashtra division table. Drill down with `division`, `district`, `centre`. ' +
    '404 `LMS_READS_DISABLED` while LMS reads are off; 404 `LMS_LIVE_DATA_OFF` while the setting "Show live LMS data" is off; 503 `LMS_NOT_CONFIGURED` without the LMS link; 503 `LMS_TIMEOUT` / ' +
    '`LMS_UNREACHABLE` / `LMS_UNAVAILABLE` / `LMS_RATE_LIMITED` / `LMS_KEY_REJECTED` / `LMS_BAD_ANSWER` when the LMS cannot be used.',
  permission: [...ATTENDANCE_REPORT_PERMISSIONS],
  request: { query: attendanceReportQuery },
  response: envelope(AttendanceReportDto),
  errors: [404, 503],
});
