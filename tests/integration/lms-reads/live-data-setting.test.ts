import type { Express } from 'express';
import { env } from '../../../src/config/env.config';
import { lmsReadsService } from '../../../src/modules/lms-reads';
import { LiveDataStateDto, LmsBatchDto, LmsSummaryDto } from '../../../src/modules/lms-reads/lms-reads.openapi';
import { envelope, pagedEnvelope } from '../../../src/shared/openapi/registry';
import { FAKE_LMS_KEY, startFakeLmsReads, type FakeLmsReads } from '../../helpers/fake-lms-reads';
import { actorWith, API, AppDataSource, auth, request, setupTestApp, superAdmin, teardownTestApp } from '../../helpers/test-app';

/*
 * G-2 "Show live LMS data" (docs/mt-g2-live-data-setting.md): the setting (default off), the master switch
 * LMS_READS_ENABLED, the audit of every change, and the data routes on both paths with the LMS faked in process.
 *
 * The off path is pinned as contract snapshots: with the setting off the answers are the ones the routes gave before
 * G-2 (M1), so screens that do not opt in see no change.
 */
let app: Express;
let lms: FakeLmsReads;
let admin: string;
const original = {
  LMS_READS_ENABLED: env.LMS_READS_ENABLED,
  LMS_EXTERNAL_BASE_URL: env.LMS_EXTERNAL_BASE_URL,
  LMS_TENANT_API_KEY: env.LMS_TENANT_API_KEY,
  LMS_TENANT_CODE: env.LMS_TENANT_CODE,
  LMS_READS_TIMEOUT_MS: env.LMS_READS_TIMEOUT_MS,
  LMS_READS_CACHE_SECONDS: env.LMS_READS_CACHE_SECONDS,
};
const setEnv = (v: Partial<typeof original>) => Object.assign(env, v);
const TENANT = 'TEST_TENANT';

beforeAll(async () => {
  app = await setupTestApp();
  lms = await startFakeLmsReads();
  admin = (await superAdmin()).token;
});
afterAll(async () => {
  setEnv(original);
  await lms.close();
  await teardownTestApp();
});
beforeEach(async () => {
  setEnv({
    LMS_READS_ENABLED: false,
    LMS_EXTERNAL_BASE_URL: lms.url,
    LMS_TENANT_API_KEY: FAKE_LMS_KEY,
    LMS_TENANT_CODE: TENANT,
    LMS_READS_TIMEOUT_MS: 2000,
    LMS_READS_CACHE_SECONDS: 0,
  });
  await AppDataSource.query(`DELETE FROM "panel_settings"`);
  /* audit_logs is append-only (DELETE blocked); TRUNCATE is allowed on the test database. */
  await AppDataSource.query(`TRUNCATE "audit_logs"`);
  lmsReadsService.clearCache();
  lms.mode = 'ok';
  lms.calls = [];
});

const get = (path: string, token = admin) => request(app).get(`${API}/lms-reads${path}`).set(auth(token));
const put = (enabled: unknown, token = admin) => request(app).put(`${API}/lms-reads/live-data`).set(auth(token)).send({ enabled });
const DATA_ROUTES = ['/summary', '/centres', '/batches', '/sessions', '/live-sessions', '/trainers', '/attendance'];
/* An error body without the per-request id, for snapshots. */
const stable = (body: { error?: { requestId?: string } }) => ({ ...body, error: { ...body.error, requestId: '<id>' } });
const audits = () =>
  AppDataSource.query(
    `SELECT "action", "resource", "resourceId", "details", "actorUserId" FROM "audit_logs" WHERE "action" = 'lms.live_data.update' ORDER BY "createdAt"`,
  );

describe('off path (default): unchanged answers', () => {
  it('the setting starts off; the screens are told to show local data', async () => {
    const res = await get('/live-data');
    expect(res.status).toBe(200);
    expect(envelope(LiveDataStateDto).safeParse(res.body).success).toBe(true);
    expect(res.body.data).toEqual({
      setting: false,
      masterSwitch: false,
      configured: true,
      canEnable: false,
      blocker: 'MASTER_SWITCH_OFF',
      missing: [],
      live: false,
      source: 'local',
      updatedAt: null,
      updatedByUserId: null,
    });
  });

  it('master switch off: every data route answers exactly the M1 404 LMS_READS_DISABLED, nothing reaches the LMS', async () => {
    for (const p of DATA_ROUTES) {
      const res = await get(p);
      expect(res.status).toBe(404);
      expect(stable(res.body)).toEqual({
        success: false,
        status: 404,
        message: 'LMS reads are switched off (LMS_READS_ENABLED)',
        data: null,
        error: { code: 'LMS_READS_DISABLED', requestId: '<id>' },
      });
      expect(res.body).not.toHaveProperty('source');
    }
    expect(lms.calls).toHaveLength(0);
  });

  it('the M1 status probe keeps its shape', async () => {
    const res = await get('/status');
    expect(res.body).toEqual({
      success: true,
      status: 200,
      message: 'LMS reads status retrieved successfully',
      data: { enabled: false, configured: true, cacheSeconds: 0, timeoutMs: 2000 },
    });
  });

  it('master switch on but setting off: 404 LMS_LIVE_DATA_OFF, nothing reaches the LMS', async () => {
    setEnv({ LMS_READS_ENABLED: true });
    for (const p of DATA_ROUTES) {
      const res = await get(p);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('LMS_LIVE_DATA_OFF');
      expect(res.body.data).toBeNull();
    }
    expect(lms.calls).toHaveLength(0);
  });
});

describe('switching on', () => {
  it('is refused while the master switch is off (409, nothing stored, nothing audited)', async () => {
    const res = await put(true);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LMS_LIVE_DATA_UNAVAILABLE');
    expect(res.body.error.details).toContainEqual({ field: 'blocker', message: 'MASTER_SWITCH_OFF' });
    expect((await get('/live-data')).body.data.setting).toBe(false);
    expect(await audits()).toHaveLength(0);
  });

  it('is refused while the LMS link is incomplete, naming the missing variables only', async () => {
    setEnv({ LMS_READS_ENABLED: true, LMS_TENANT_CODE: undefined });
    const state = await get('/live-data');
    expect(state.body.data).toMatchObject({ canEnable: false, blocker: 'LMS_NOT_CONFIGURED', missing: ['LMS_TENANT_CODE'] });
    const res = await put(true);
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual([
      { field: 'blocker', message: 'LMS_NOT_CONFIGURED' },
      { field: 'missing', message: 'LMS_TENANT_CODE' },
    ]);
    expect(JSON.stringify(res.body)).not.toContain(FAKE_LMS_KEY);
    expect(JSON.stringify(res.body)).not.toContain(lms.url);
  });

  it('needs settings.update; LMS screen users and settings.view may only read the state', async () => {
    setEnv({ LMS_READS_ENABLED: true });
    const viewer = await actorWith(['settings.view']);
    const screen = await actorWith(['batches.view']);
    const other = await actorWith(['users.view']);
    expect((await get('/live-data', viewer.token)).status).toBe(200);
    expect((await get('/live-data', screen.token)).status).toBe(200);
    expect((await get('/live-data', other.token)).status).toBe(403);
    expect((await put(true, viewer.token)).status).toBe(403);
    expect((await put(true, screen.token)).status).toBe(403);
    const editor = await actorWith(['settings.update']);
    expect((await put(true, editor.token)).status).toBe(200);
  });

  it('validates the body', async () => {
    setEnv({ LMS_READS_ENABLED: true });
    expect((await put('yes')).status).toBe(422);
    expect((await request(app).put(`${API}/lms-reads/live-data`).set(auth(admin)).send({ enabled: true, extra: 1 })).status).toBe(422);
  });

  it('on: is stored and audited; the data routes answer live with source and fetched_at', async () => {
    setEnv({ LMS_READS_ENABLED: true });
    const res = await put(true);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ setting: true, live: true, source: 'live', canEnable: true, blocker: null });
    expect(res.body.data.updatedAt).toEqual(expect.any(String));

    const summary = await get('/summary');
    expect(summary.status).toBe(200);
    expect(envelope(LmsSummaryDto).safeParse(summary.body).success).toBe(true);
    expect(summary.body.source).toBe('live');
    expect(summary.body.fetched_at).toBe(summary.headers['x-lms-fetched-at']);
    expect(Number.isNaN(Date.parse(summary.body.fetched_at))).toBe(false);

    const batches = await get('/batches?page=1&limit=10');
    expect(pagedEnvelope(LmsBatchDto).safeParse(batches.body).success).toBe(true);
    expect(batches.body).toMatchObject({ source: 'live', meta: { page: 1, limit: 10 } });
    expect(batches.body.data[0]).toMatchObject({ code: 'NAG-01-B3' });
    expect(lms.calls.map((c) => c.path)).toEqual(['/summary', '/batches']);

    /* Switching on twice changes nothing and is audited once. */
    expect((await put(true)).status).toBe(200);
    expect(await audits()).toEqual([
      {
        action: 'lms.live_data.update',
        resource: 'panel_setting',
        resourceId: 'lms.live_data',
        details: { from: false, to: true },
        actorUserId: expect.any(String),
      },
    ]);
  });

  it('LMS unreachable while on: a clear 503, never local data, never a mixed answer', async () => {
    setEnv({ LMS_READS_ENABLED: true });
    await put(true);
    lms.mode = 'down';
    const res = await get('/batches');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ success: false, data: null, error: { code: 'LMS_UNAVAILABLE' } });
    expect(res.body).not.toHaveProperty('source');
    lms.mode = 'drop';
    expect((await get('/centres')).body.error.code).toBe('LMS_UNREACHABLE');
  });

  it('master switch turned off later: live reads stop even though the setting stays on', async () => {
    setEnv({ LMS_READS_ENABLED: true });
    await put(true);
    setEnv({ LMS_READS_ENABLED: false });
    expect((await get('/live-data')).body.data).toMatchObject({ setting: true, masterSwitch: false, live: false, source: 'local' });
    expect((await get('/batches')).body.error.code).toBe('LMS_READS_DISABLED');
    expect(lms.calls).toHaveLength(0);
  });
});

describe('switching off', () => {
  it('is always allowed, audited, and the data routes refuse again', async () => {
    setEnv({ LMS_READS_ENABLED: true });
    await put(true);
    setEnv({ LMS_READS_ENABLED: false, LMS_TENANT_CODE: undefined });
    const res = await put(false);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ setting: false, live: false, source: 'local' });
    expect((await audits()).map((a: { details: unknown }) => a.details)).toEqual([
      { from: false, to: true },
      { from: true, to: false },
    ]);
    setEnv({ LMS_READS_ENABLED: true, LMS_TENANT_CODE: TENANT });
    expect((await get('/summary')).body.error.code).toBe('LMS_LIVE_DATA_OFF');
  });
});
