import { AttendanceReportsService, type AttendanceReportsDeps } from '../../../src/modules/attendance-reports/attendance-reports.service';
import { attendanceReportQuery } from '../../../src/modules/attendance-reports/attendance-reports.validation';
import { AppError } from '../../../src/shared/errors/app-error';
import type { LmsBatch } from '../../../src/modules/lms-reads';

/* M3 service with the LMS reads and masters faked: what is asked of the LMS, batch paging, errors passed through. */
const counts = {
  batches: 1,
  sessionsHeld: 1,
  present: 1,
  late: 0,
  absent: 0,
  excused: 0,
  selfCheckIns: 0,
  geoCheckIns: 0,
  selfies: 0,
  groupPhotos: 0,
};
const fetchedAt = new Date('2026-11-21T07:00:00.000Z');

function deps(over: Partial<AttendanceReportsDeps> = {}) {
  const calls: unknown[] = [];
  const d = {
    status: () => ({ enabled: true, configured: true, cacheSeconds: 30, timeoutMs: 8000 }),
    attendance: jest.fn(async (q: Parameters<AttendanceReportsDeps['attendance']>[0]) => {
      calls.push(q);
      return {
        data: {
          groupBy: q.groupBy,
          dateFrom: q.dateFrom ?? '2026-10-23',
          dateTo: q.dateTo ?? '2026-11-21',
          items: [{ code: 'B1', ...counts }],
        },
        fetchedAt,
        cache: 'MISS' as const,
      };
    }),
    batches: jest.fn(async (q: { page: number; limit: number }) => ({
      data: q.page <= 2 ? [{ code: `B${q.page}`, centreCode: 'PUN-01' } as LmsBatch] : [],
      meta: { page: q.page, limit: q.limit, total: 150, totalPages: 2 },
      fetchedAt,
      cache: 'MISS' as const,
    })),
    masters: jest.fn(async () => ({
      districts: [{ code: 'PUN', name: 'Pune' }],
      centres: [{ code: 'PUN-01', name: 'Pune One', districtCode: 'PUN' }],
    })),
    ...over,
  };
  return { d, calls };
}

const q = (v: Record<string, unknown>) => attendanceReportQuery.parse(v);

describe('AttendanceReportsService', () => {
  it('asks the LMS for the level as group_by with the dates and entity, and echoes the LMS range', async () => {
    const { d, calls } = deps();
    const r = await new AttendanceReportsService(d).report(
      q({ level: 'district', dateFrom: '2026-11-01', dateTo: '2026-11-20', entityCode: 'SBX-08' }),
    );
    expect(calls).toEqual([{ groupBy: 'district', dateFrom: '2026-11-01', dateTo: '2026-11-20', entityCode: 'SBX-08' }]);
    expect(r.data).toMatchObject({ level: 'district', dateFrom: '2026-11-01', dateTo: '2026-11-20' });
    expect(r.fetchedAt).toBe(fetchedAt);
    expect(d.batches).not.toHaveBeenCalled();
  });

  it('batch level pages through the LMS batch list until its total', async () => {
    const { d } = deps();
    const r = await new AttendanceReportsService(d).report(q({ level: 'batch', centre: 'PUN-01' }));
    expect(d.batches).toHaveBeenCalledTimes(2);
    expect(r.data.rows.map((x) => x.code)).toEqual(['B1']);
    expect(r.data.rows[0].centre?.name).toBe('Pune One');
  });

  it('an LMS refusal is passed through and no master is read', async () => {
    const refused = new AppError(503, 'LMS reads are not configured', 'LMS_NOT_CONFIGURED');
    const { d } = deps({ attendance: jest.fn(async () => Promise.reject(refused)) });
    await expect(new AttendanceReportsService(d).report(q({}))).rejects.toBe(refused);
    expect(d.masters).not.toHaveBeenCalled();
  });
});

describe('query', () => {
  it('defaults to division level and accepts up to 366 days', () => {
    expect(q({}).level).toBe('division');
    expect(attendanceReportQuery.safeParse({ dateFrom: '2025-11-21', dateTo: '2026-11-21' }).success).toBe(true);
  });
  it('refuses more than 366 days, a reversed range, bad codes and unknown levels', () => {
    expect(attendanceReportQuery.safeParse({ dateFrom: '2025-11-20', dateTo: '2026-11-21' }).success).toBe(false);
    expect(attendanceReportQuery.safeParse({ dateFrom: '2026-11-21', dateTo: '2026-11-01' }).success).toBe(false);
    expect(attendanceReportQuery.safeParse({ district: 'a b' }).success).toBe(false);
    expect(attendanceReportQuery.safeParse({ level: 'state' }).success).toBe(false);
  });
});
