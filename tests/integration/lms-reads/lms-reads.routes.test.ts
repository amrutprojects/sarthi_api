import type { Express } from 'express';
import type { ZodTypeAny } from 'zod';
import { env } from '../../../src/config/env.config';
import { lmsReadsService } from '../../../src/modules/lms-reads';
import {
  LmsAttendanceDto,
  LmsBatchDto,
  LmsCentreDto,
  LmsDistrictDto,
  LmsLiveSessionsDto,
  LmsReadsStatusDto,
  LmsSessionDto,
  LmsSummaryDto,
  LmsTrainerDto,
  LmsTrackDto,
} from '../../../src/modules/lms-reads/lms-reads.openapi';
import { envelope, pagedEnvelope } from '../../../src/shared/openapi/registry';
import { FAKE_LMS_KEY, startFakeLmsReads, type FakeLmsReads } from '../../helpers/fake-lms-reads';
import { actorWith, API, AppDataSource, auth, request, setupTestApp, superAdmin, teardownTestApp } from '../../helpers/test-app';

/*
 * /api/v1/lms-reads with the LMS faked in process (tests/helpers/fake-lms-reads.ts). The switch and the LMS settings
 * are changed on the parsed `env` object, which the service reads on every request.
 * G-2: the Panel setting "Show live LMS data" is switched on for this file (its off / on paths are in live-data-setting.test.ts).
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

beforeAll(async () => {
  app = await setupTestApp();
  lms = await startFakeLmsReads();
  admin = (await superAdmin()).token;
  await AppDataSource.query(`INSERT INTO "panel_settings" ("key", "value") VALUES ('lms.live_data', '{"enabled": true}')`);
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
});

const get = (path: string, token = admin) => request(app).get(`${API}/lms-reads${path}`).set(auth(token));
const check = (schema: ZodTypeAny, body: unknown) => {
  const r = schema.safeParse(body);
  if (!r.success) throw new Error(JSON.stringify(r.error.issues.slice(0, 5), null, 2));
};

const DATA_ROUTES = [
  '/summary',
  '/centres',
  '/tracks',
  '/districts',
  '/batches',
  '/sessions',
  '/live-sessions',
  '/trainers',
  '/attendance',
];

describe('switch', () => {
  it('while LMS_READS_ENABLED is off, data routes answer 404 LMS_READS_DISABLED and nothing reaches the LMS', async () => {
    setEnv({ LMS_READS_ENABLED: false });
    for (const p of DATA_ROUTES) {
      const res = await get(p);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('LMS_READS_DISABLED');
    }
    expect(lms.calls).toHaveLength(0);
    const status = await get('/status');
    expect(status.status).toBe(200);
    check(envelope(LmsReadsStatusDto), status.body);
    expect(status.body.data.enabled).toBe(false);
  });

  it('status never reveals the key or the LMS URL', async () => {
    const res = await get('/status');
    expect(res.body.data).toEqual({ enabled: true, configured: true, cacheSeconds: 30, timeoutMs: 2000 });
    expect(JSON.stringify(res.body)).not.toContain(FAKE_LMS_KEY);
    expect(JSON.stringify(res.body)).not.toContain(lms.url);
  });
});

describe('permissions', () => {
  it('needs a session', async () => {
    expect((await request(app).get(`${API}/lms-reads/batches`)).status).toBe(401);
  });

  it('refuses a user without any LMS screen right', async () => {
    const { token } = await actorWith(['users.view']);
    for (const p of ['/status', ...DATA_ROUTES]) expect((await get(p, token)).status).toBe(403);
    expect(lms.calls).toHaveLength(0);
  });

  it('opens each read to the rights of the screen it feeds', async () => {
    const { token } = await actorWith(['batches.view']);
    expect((await get('/batches', token)).status).toBe(200);
    expect((await get('/status', token)).status).toBe(200);
    for (const p of ['/summary', '/centres', '/tracks', '/districts', '/sessions', '/live-sessions', '/trainers', '/attendance'])
      expect((await get(p, token)).status).toBe(403);

    const centres = await actorWith(['centres.view']);
    for (const p of ['/centres', '/tracks', '/districts']) expect((await get(p, centres.token)).status).toBe(200);
    expect((await get('/batches', centres.token)).status).toBe(403);

    const live = await actorWith(['live.view']);
    expect((await get('/live-sessions', live.token)).status).toBe(200);
    expect((await get('/sessions', live.token)).status).toBe(200);

    const lmsIntegration = await actorWith(['lms.view']);
    for (const p of DATA_ROUTES) expect((await get(p, lmsIntegration.token)).status).toBe(200);
  });
});

describe('reads from the LMS', () => {
  it('summary', async () => {
    const res = await get('/summary');
    expect(res.status).toBe(200);
    check(envelope(LmsSummaryDto), res.body);
    expect(res.body.data).toMatchObject({
      tenant: { code: 'AMRUT' },
      centresActive: 1,
      attendance: { attendancePercent: 88.9 },
      byBatch: [{ batchCode: 'NAG-01-B3', learners: 25 }],
    });
    expect(lms.calls[0]).toMatchObject({ path: '/summary', apiKey: FAKE_LMS_KEY });
  });

  it('lists with Panel paging (page / limit → page / page_size) and filters', async () => {
    const res = await get('/batches?page=2&limit=5&entityCode=SBX-08&updatedSince=2026-11-01T00:00:00Z');
    expect(res.status).toBe(200);
    check(pagedEnvelope(LmsBatchDto), res.body);
    expect(res.body.data[0]).toMatchObject({ code: 'NAG-01-B3', learnersEnrolled: 25, capacity: 30 });
    expect(res.body.meta).toEqual({ page: 2, limit: 5, total: 1, totalPages: 1 });
    expect(lms.calls[0].query).toEqual({ page: '2', page_size: '5', entity_code: 'SBX-08', updated_since: '2026-11-01T00:00:00Z' });
  });

  it('centres, sessions, trainers in the documented shapes', async () => {
    const centres = await get('/centres');
    check(pagedEnvelope(LmsCentreDto), centres.body);
    expect(centres.body.data[0]).toMatchObject({ code: 'NAG-01', districtName: 'Nagpur', centreTypeName: 'ITI', isActive: true });
    expect(centres.body.data[0]).toMatchObject({ entityCode: 'SBX-08', divisionName: 'Nagpur Division', tracksOffered: ['T03'] });

    const sessions = await get('/sessions');
    check(pagedEnvelope(LmsSessionDto), sessions.body);
    expect(sessions.body.data[0].attendance).toEqual({ present: 20, late: 2, absent: 3, excused: 0 });

    const trainers = await get('/trainers');
    check(pagedEnvelope(LmsTrainerDto), trainers.body);
    expect(trainers.body.data[0]).toMatchObject({ code: 'TR-1', centreCodes: ['NAG-01'] });
  });

  it('entity-owned tracks and districts in the documented shapes, with the list filters', async () => {
    const tracks = await get('/tracks?entityCode=SBX-08');
    expect(tracks.status).toBe(200);
    check(pagedEnvelope(LmsTrackDto), tracks.body);
    expect(tracks.body.data[0]).toMatchObject({ entityCode: 'SBX-08', code: 'T03', name: 'Synthetic Track', isActive: true });
    expect(lms.calls[0]).toMatchObject({ path: '/tracks', apiKey: FAKE_LMS_KEY, query: { entity_code: 'SBX-08' } });

    const districts = await get('/districts?page=1&limit=20');
    expect(districts.status).toBe(200);
    check(pagedEnvelope(LmsDistrictDto), districts.body);
    expect(districts.body.data[0]).toMatchObject({ code: 'NAG', nameEn: 'Nagpur', divisionCode: 'NGP', divisionName: 'Nagpur Division' });
    expect(districts.body.meta).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
  });

  it('live sessions of a day and attendance counts', async () => {
    const live = await get('/live-sessions?date=2026-11-21&deliveryMode=OFFLINE');
    expect(live.status).toBe(200);
    check(envelope(LmsLiveSessionsDto), live.body);
    expect(live.body.data.items[0]).toMatchObject({ inProgress: true, present: 20, trainerName: 'Synthetic Trainer' });
    expect(live.body.data.items[0]).not.toHaveProperty('lmsEntityId');
    expect(lms.calls[0].query).toEqual({ date: '2026-11-21', delivery_mode: 'OFFLINE' });

    const att = await get('/attendance?groupBy=centre&dateFrom=2026-11-01&dateTo=2026-11-21');
    expect(att.status).toBe(200);
    check(envelope(LmsAttendanceDto), att.body);
    expect(att.body.data).toMatchObject({ groupBy: 'centre', items: [{ code: 'NAG', sessionsHeld: 4, groupPhotos: 4 }] });
  });

  it('caches for LMS_READS_CACHE_SECONDS and says so in the headers', async () => {
    const first = await get('/trainers');
    const second = await get('/trainers');
    expect(first.headers['x-lms-cache']).toBe('MISS');
    expect(second.headers['x-lms-cache']).toBe('HIT');
    expect(second.headers['x-lms-fetched-at']).toBe(first.headers['x-lms-fetched-at']);
    expect(lms.calls).toHaveLength(1);

    setEnv({ LMS_READS_CACHE_SECONDS: 0 });
    await get('/trainers');
    await get('/trainers');
    expect(lms.calls).toHaveLength(3);
  });

  it('validates the Panel query before calling the LMS', async () => {
    expect((await get('/batches?limit=1000')).status).toBe(422);
    expect((await get('/batches?updatedSince=yesterday')).status).toBe(422);
    expect((await get('/attendance?dateFrom=2026-11-21&dateTo=2026-11-01')).status).toBe(422);
    expect((await get('/live-sessions?deliveryMode=HYBRID')).status).toBe(422);
    expect(lms.calls).toHaveLength(0);
  });
});

describe('when the LMS cannot be used', () => {
  beforeEach(() => setEnv({ LMS_READS_CACHE_SECONDS: 0 }));

  const expectError = async (path: string, status: number, code: string) => {
    const res = await get(path);
    expect(res.status).toBe(status);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe(code);
    expect(JSON.stringify(res.body)).not.toContain(FAKE_LMS_KEY);
    expect(JSON.stringify(res.body)).not.toContain(lms.url);
    return res;
  };

  it('LMS down → 503 LMS_UNAVAILABLE with the LMS request id', async () => {
    lms.mode = 'down';
    const res = await expectError('/batches', 503, 'LMS_UNAVAILABLE');
    expect(res.body.error.details).toContainEqual({ field: 'lmsRequestId', message: 'fake-rq-503' });
  });

  it('LMS too slow → 503 LMS_TIMEOUT', async () => {
    setEnv({ LMS_READS_TIMEOUT_MS: 200 });
    lms.mode = 'slow';
    await expectError('/summary', 503, 'LMS_TIMEOUT');
  });

  it('connection dropped → 503 LMS_UNREACHABLE', async () => {
    lms.mode = 'drop';
    await expectError('/centres', 503, 'LMS_UNREACHABLE');
  });

  it('LMS not listening → 503 LMS_UNREACHABLE', async () => {
    setEnv({ LMS_EXTERNAL_BASE_URL: 'http://127.0.0.1:9' });
    await expectError('/centres', 503, 'LMS_UNREACHABLE');
  });

  it('key refused → 503 LMS_KEY_REJECTED', async () => {
    setEnv({ LMS_TENANT_API_KEY: 'a-wrong-tenant-key-0000000000' });
    const res = await expectError('/trainers', 503, 'LMS_KEY_REJECTED');
    expect(res.body.error.details).toContainEqual({ field: 'lmsCode', message: 'EXTERNAL_KEY_INVALID' });
  });

  it('unknown entity → 404 LMS_NOT_FOUND', async () => {
    await expectError('/summary?entityCode=NOPE', 404, 'LMS_NOT_FOUND');
  });

  it('switched on without URL or key → 503 LMS_NOT_CONFIGURED', async () => {
    setEnv({ LMS_TENANT_API_KEY: undefined });
    await expectError('/summary', 503, 'LMS_NOT_CONFIGURED');
  });
});
