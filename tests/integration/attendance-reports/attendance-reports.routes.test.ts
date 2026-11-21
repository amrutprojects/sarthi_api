import type { Express } from 'express';
import type { ZodTypeAny } from 'zod';
import { env } from '../../../src/config/env.config';
import { lmsReadsService } from '../../../src/modules/lms-reads';
import { AttendanceReportDto, AttendanceReportsStatusDto } from '../../../src/modules/attendance-reports/attendance-reports.openapi';
import { envelope } from '../../../src/shared/openapi/registry';
import { FAKE_LMS_KEY, startFakeLmsReads, type FakeLmsReads } from '../../helpers/fake-lms-reads';
import { actorWith, API, AppDataSource, auth, request, setupTestApp, superAdmin, teardownTestApp } from '../../helpers/test-app';

/*
 * M3 /api/v1/attendance-reports with the LMS faked in process (tests/helpers/fake-lms-reads.ts) and Amrut's district
 * and centre masters seeded with synthetic rows. The LMS settings are changed on the parsed `env` object, which the
 * M1 read service reads on every request.
 */
let app: Express;
let lms: FakeLmsReads;
let admin: string;
const original = {
  LMS_READS_ENABLED: env.LMS_READS_ENABLED,
  LMS_EXTERNAL_BASE_URL: env.LMS_EXTERNAL_BASE_URL,
  LMS_TENANT_API_KEY: env.LMS_TENANT_API_KEY,
  LMS_READS_TIMEOUT_MS: env.LMS_READS_TIMEOUT_MS,
  LMS_READS_CACHE_SECONDS: env.LMS_READS_CACHE_SECONDS,
};
const setEnv = (v: Partial<typeof original>) => Object.assign(env, v);

const counts = (present: number, late: number, absent: number, excused = 0) => ({
  batches: 1,
  sessions_held: 4,
  present,
  late,
  absent,
  excused,
  self_check_ins: 6,
  geo_check_ins: 5,
  selfies: 4,
  group_photos: 2,
});

async function seedMasters() {
  const [state] = await AppDataSource.query<{ id: string }[]>(
    `INSERT INTO "states" ("name", "code") VALUES ('Maharashtra (test)', 'MHT') RETURNING "id"`,
  );
  const district = async (name: string, code: string) =>
    (
      await AppDataSource.query<{ id: string }[]>(
        `INSERT INTO "districts" ("stateId", "name", "code") VALUES ($1, $2, $3) RETURNING "id"`,
        [state.id, name, code],
      )
    )[0].id;
  const pun = await district('Pune', 'PUN');
  const ngp = await district('Nagpur', 'NGP');
  const centre = (name: string, code: string, districtId: string) =>
    AppDataSource.query(`INSERT INTO "training_centres" ("name", "code", "districtId") VALUES ($1, $2, $3)`, [name, code, districtId]);
  await centre('Pune Test Centre', 'PUN01', pun);
  await centre('Nagpur Test Centre', 'NGP01', ngp);
}

beforeAll(async () => {
  app = await setupTestApp();
  lms = await startFakeLmsReads();
  admin = (await superAdmin()).token;
  await seedMasters();
});
afterAll(async () => {
  setEnv(original);
  await lms.close();
  await teardownTestApp();
});
beforeEach(() => {
  setEnv({
    LMS_READS_ENABLED: true,
    LMS_EXTERNAL_BASE_URL: lms.url,
    LMS_TENANT_API_KEY: FAKE_LMS_KEY,
    LMS_READS_TIMEOUT_MS: 2000,
    LMS_READS_CACHE_SECONDS: 30,
  });
  lmsReadsService.clearCache();
  lms.mode = 'ok';
  lms.calls = [];
  lms.batchItems = undefined;
  lms.attendanceItems = {
    division: [
      { code: 'PUNE', ...counts(70, 10, 20) },
      { code: 'NAGPUR', ...counts(9, 0, 1) },
    ],
    district: [
      { code: 'PUN', ...counts(70, 10, 20) },
      { code: 'NGP', ...counts(9, 0, 1) },
      { code: 'UNKNOWN', ...counts(1, 0, 0) },
    ],
    centre: [
      { code: 'PUN01', ...counts(70, 10, 20) },
      { code: 'NGP01', ...counts(9, 0, 1) },
    ],
    batch: [
      { code: 'PUN01-B1', ...counts(30, 0, 10) },
      { code: 'NGP01-B1', ...counts(9, 0, 1) },
    ],
  };
});

const get = (path: string, token = admin) => request(app).get(`${API}/attendance-reports${path}`).set(auth(token));
const check = (schema: ZodTypeAny, body: unknown) => {
  const r = schema.safeParse(body);
  if (!r.success) throw new Error(JSON.stringify(r.error.issues.slice(0, 5), null, 2));
};

describe('reports', () => {
  it('division level: Amrut names (en + mr), percentages, evidence counts, source headers', async () => {
    const res = await get('?level=division&dateFrom=2026-11-01&dateTo=2026-11-20');
    expect(res.status).toBe(200);
    check(envelope(AttendanceReportDto), res.body);
    expect(res.headers['x-lms-cache']).toBe('MISS');
    expect(res.headers['x-lms-fetched-at']).toBeTruthy();
    const d = res.body.data;
    expect(d).toMatchObject({ level: 'division', dateFrom: '2026-11-01', dateTo: '2026-11-20' });
    expect(d.rows.map((r: { name: string; nameMr: string }) => [r.name, r.nameMr])).toEqual([
      ['Nagpur', 'नागपूर'],
      ['Pune', 'पुणे'],
    ]);
    expect(d.rows[1]).toMatchObject({ marked: 100, presentPercent: 70, latePercent: 10, absentPercent: 20, selfies: 4, groupPhotos: 2 });
    expect(d.totals).toMatchObject({ present: 79, marked: 110, presentPercent: 71.8, selfCheckIns: 12 });
    expect(lms.calls).toEqual([
      expect.objectContaining({ path: '/attendance', query: { group_by: 'division', date_from: '2026-11-01', date_to: '2026-11-20' } }),
    ]);
  });

  it('district level under a division: names from the District Master, unplaceable rows counted', async () => {
    const res = await get('?level=district&division=PUNE');
    expect(res.status).toBe(200);
    check(envelope(AttendanceReportDto), res.body);
    expect(res.body.data.rows.map((r: { code: string; name: string }) => [r.code, r.name])).toEqual([['PUN', 'Pune']]);
    expect(res.body.data.unplaced).toBe(1);
    expect(res.body.data.filters.division).toEqual({ code: 'PUNE', name: 'Pune', nameMr: 'पुणे' });
  });

  it('centre level under a district: centre names from the Training Centre master', async () => {
    const res = await get('?level=centre&district=NGP');
    expect(res.status).toBe(200);
    expect(res.body.data.rows).toEqual([
      expect.objectContaining({ code: 'NGP01', name: 'Nagpur Test Centre', district: { code: 'NGP', name: 'Nagpur', nameMr: 'नागपूर' } }),
    ]);
  });

  it('batch level under a centre: batches placed through the LMS batch list', async () => {
    lms.batchItems = [
      { batch_code: 'PUN01-B1', centre_code: 'PUN01' },
      { batch_code: 'NGP01-B1', centre_code: 'NGP01' },
    ];
    const res = await get('?level=batch&centre=PUN01');
    expect(res.status).toBe(200);
    expect(res.body.data.rows.map((r: { code: string }) => r.code)).toEqual(['PUN01-B1']);
    expect(res.body.data.totals.presentPercent).toBe(75);
    expect(lms.calls.map((c) => c.path).sort()).toEqual(['/attendance', '/batches']);
  });

  it('an empty LMS answer is an empty report, not an error', async () => {
    lms.attendanceItems.district = [];
    const res = await get('?level=district');
    expect(res.status).toBe(200);
    expect(res.body.data.rows).toEqual([]);
    expect(res.body.data.totals.presentPercent).toBeNull();
  });

  it('a second identical read is served from the short cache', async () => {
    await get('?level=division');
    const res = await get('?level=division');
    expect(res.headers['x-lms-cache']).toBe('HIT');
    expect(lms.calls).toHaveLength(1);
  });

  it('refuses a range over 366 days before any LMS call', async () => {
    const res = await get('?dateFrom=2025-01-01&dateTo=2026-11-20');
    expect(res.status).toBe(422);
    expect(lms.calls).toHaveLength(0);
  });
});

describe('not available', () => {
  it('reads off: 404 LMS_READS_DISABLED, and status says so', async () => {
    setEnv({ LMS_READS_ENABLED: false });
    const res = await get('');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('LMS_READS_DISABLED');
    expect(lms.calls).toHaveLength(0);
    const status = await get('/status');
    expect(status.status).toBe(200);
    check(envelope(AttendanceReportsStatusDto), status.body);
    expect(status.body.data).toMatchObject({ enabled: false });
  });

  it('LMS link not configured: 503 LMS_NOT_CONFIGURED', async () => {
    setEnv({ LMS_TENANT_API_KEY: undefined });
    const res = await get('');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('LMS_NOT_CONFIGURED');
    expect((await get('/status')).body.data.configured).toBe(false);
  });

  it('LMS down: 503 LMS_UNAVAILABLE, and the key never appears in the answer', async () => {
    lms.mode = 'down';
    const res = await get('?level=district');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('LMS_UNAVAILABLE');
    expect(JSON.stringify(res.body)).not.toContain(FAKE_LMS_KEY);
  });

  it('LMS unreachable and timeouts are distinct codes', async () => {
    lms.mode = 'drop';
    expect((await get('?level=centre')).body.error.code).toBe('LMS_UNREACHABLE');
    setEnv({ LMS_READS_TIMEOUT_MS: 200 });
    lms.mode = 'slow';
    expect((await get('?level=batch')).body.error.code).toBe('LMS_TIMEOUT');
  });

  it('a rejected key: 503 LMS_KEY_REJECTED', async () => {
    setEnv({ LMS_TENANT_API_KEY: 'wrong-key-wrong-key-wrong-key-0000' });
    const res = await get('');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('LMS_KEY_REJECTED');
  });
});

describe('permissions', () => {
  it('attendance.view, reports.view or lms.view may read; others get 403 and nothing reaches the LMS', async () => {
    for (const code of ['attendance.view', 'reports.view', 'lms.view']) {
      const { token } = await actorWith([code]);
      expect((await get('?level=division', token)).status).toBe(200);
    }
    lms.calls = [];
    const { token } = await actorWith(['candidates.view']);
    expect((await get('', token)).status).toBe(403);
    expect((await get('/status', token)).status).toBe(403);
    expect(lms.calls).toHaveLength(0);
  });

  it('needs a session', async () => {
    expect((await request(app).get(`${API}/attendance-reports`)).status).toBe(401);
  });
});
