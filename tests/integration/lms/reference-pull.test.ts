import type { Express } from 'express';
import { appConfig } from '../../../src/config/app.config';
import { signLmsRequest } from '../../../src/modules/lms-access';
import { API, AppDataSource, auth, request, setupTestApp, superAdmin, teardownTestApp, type TestActor } from '../../helpers/test-app';

/*
 * API-122 GET /integration/v1/reference — the reference pull the LMS server (lms-api) makes for its own read-only
 * copy. The Admin Panel's districts and training centres are built through the CMS API (the Admin Panel's own write
 * path), then pulled through the signed integration route the way lms-api's admin-panel.client signs its calls.
 */

let app: Express;
let admin: TestActor;

const PATH = '/integration/v1/reference';

/* technology_tracks is seeded by its migration and kept between test files: the fixture tracks (one inactive, one
 * soft-deleted) are removed before and after this file (never a seeded T01–T12 row). */
const INACTIVE_TRACK = 'T97';
const DELETED_TRACK = 'T96';
const removeFixtureTracks = () =>
  AppDataSource.query(`DELETE FROM "technology_tracks" WHERE "code" = ANY($1)`, [[INACTIVE_TRACK, DELETED_TRACK]]);

const ids: Record<string, string> = {};

interface Row {
  status: 'ACTIVE' | 'INACTIVE';
  updated_at: string;
  [key: string]: unknown;
}
interface Pull {
  districts: Row[];
  centres: Row[];
  tracks: Row[];
  as_of: string;
  page: number;
  page_size: number;
  has_more: boolean;
}
const LISTS = ['districts', 'centres', 'tracks'] as const;

async function post(path: string, body: Record<string, unknown>): Promise<{ id: string }> {
  const res = await request(app).post(`${API}${path}`).set(auth(admin.token)).send(body);
  if (res.status !== 201) throw new Error(`POST ${path} failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data as { id: string };
}

async function call(method: 'patch' | 'delete', path: string, body?: Record<string, unknown>): Promise<void> {
  const res = await request(app)[method](`${API}${path}`).set(auth(admin.token)).send(body);
  if (res.status !== 200) throw new Error(`${method.toUpperCase()} ${path} failed (${res.status}): ${JSON.stringify(res.body)}`);
}

/* Signed the way the LMS signs: over the path with its query string, and the exact body bytes ('' for a GET). */
function signed(method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, secret = appConfig.lmsIntegration.secret) {
  const raw = method === 'get' ? '' : '{}';
  const ts = String(Math.floor(Date.now() / 1000));
  const authorization = `AMK-HMAC lms:${signLmsRequest(secret, method, path, ts, raw)}`;
  const req = request(app)[method](path).set('Authorization', authorization).set('X-Timestamp', ts);
  return method === 'get' ? req : req.set('Content-Type', 'application/json').send(raw);
}

async function pull(qs = ''): Promise<Pull> {
  const res = await signed('get', `${PATH}${qs}`);
  if (res.status !== 200) throw new Error(`pull ${qs} failed (${res.status}): ${JSON.stringify(res.body)}`);
  expect(res.body.success).toBe(true);
  return res.body.data as Pull;
}

const codes = (rows: Row[], key: string) => rows.map((r) => r[key] as string);

beforeAll(async () => {
  app = await setupTestApp();
  await removeFixtureTracks();
  admin = await superAdmin();

  /* Admin Panel geography: one state, two live districts, one deactivated and one deleted. */
  ids.state = (await post('/cms/states', { name: 'Maharashtra', code: 'MH' })).id;
  ids.pune = (await post('/cms/districts', { stateId: ids.state, name: 'Pune', code: 'PUN' })).id;
  ids.nashik = (await post('/cms/districts', { stateId: ids.state, name: 'Nashik', code: 'NSK' })).id;
  ids.ahmednagar = (await post('/cms/districts', { stateId: ids.state, name: 'Ahmednagar', code: 'AHM' })).id;
  ids.gone = (await post('/cms/districts', { stateId: ids.state, name: 'Removed District', code: 'RMV' })).id;
  await call('delete', `/cms/districts/${ids.gone}`);
  ids.haveli = (await post('/cms/talukas', { districtId: ids.pune, name: 'Haveli', code: 'HVL' })).id;

  const types = await request(app).get(`${API}/cms/centre-types/options`).set(auth(admin.token));
  ids.owned = (types.body.data as { id: string; code: string }[]).find((t) => t.code === 'OWNED')!.id;

  /* Training centres: a full profile, a minimal one, an inactive one and a deleted one. */
  ids.puneCentre = (
    await post('/cms/training-centres', {
      districtId: ids.pune,
      name: 'Pune Main Centre',
      code: 'PNC1',
      centreTypeId: ids.owned,
      talukaId: ids.haveli,
    })
  ).id;
  ids.nashikCentre = (await post('/cms/training-centres', { districtId: ids.nashik, name: 'Nashik Road Centre', code: 'NRC1' })).id;
  ids.ahmCentre = (
    await post('/cms/training-centres', { districtId: ids.ahmednagar, name: 'Ahmednagar Centre', code: 'AHC1', isActive: false })
  ).id;
  ids.oldCentre = (await post('/cms/training-centres', { districtId: ids.nashik, name: 'Old Closed Centre', code: 'OLD1' })).id;
  await call('delete', `/cms/training-centres/${ids.oldCentre}`);
  await post('/cms/centre-infrastructure', { centreId: ids.puneCentre, maxSeatingCapacity: 40, computerSystems: 30 });

  await call('patch', `/cms/districts/${ids.ahmednagar}/status`, { isActive: false });

  /* An inactive and a soft-deleted technology track next to the twelve seeded active ones. */
  await AppDataSource.query(
    `INSERT INTO "technology_tracks" ("code", "name", "aliases", "sortOrder", "isActive") VALUES ($1, 'Pull Fixture Track', '[]', 97, false)`,
    [INACTIVE_TRACK],
  );
  await AppDataSource.query(
    `INSERT INTO "technology_tracks" ("code", "name", "aliases", "sortOrder", "isActive", "isDelete")
     VALUES ($1, 'Deleted Pull Fixture Track', '[]', 96, true, true)`,
    [DELETED_TRACK],
  );
});

afterAll(async () => {
  if (AppDataSource.isInitialized) await removeFixtureTracks();
  await teardownTestApp();
});

describe('signature', () => {
  it('refuses an unsigned call with 401', async () => {
    const res = await request(app).get(PATH);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, error: { code: 'SIGNATURE_INVALID' } });
  });

  it('refuses a bad signature with 401', async () => {
    const res = await signed('get', PATH, 'another-secret-another-secret-0123456789');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SIGNATURE_INVALID');
    /* Signed for one query string, sent with another. */
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signLmsRequest(appConfig.lmsIntegration.secret, 'GET', `${PATH}?page=1`, ts, '');
    const tampered = await request(app).get(`${PATH}?page=2`).set('Authorization', `AMK-HMAC lms:${sig}`).set('X-Timestamp', ts);
    expect(tampered.status).toBe(401);
  });
});

describe('GET /integration/v1/reference', () => {
  it('returns every list with deleted and inactive rows as INACTIVE', async () => {
    const d = await pull();
    expect(d).toMatchObject({ page: 1, page_size: 500, has_more: false });
    expect(Number.isNaN(Date.parse(d.as_of))).toBe(false);

    const status = (rows: Row[], key: string) => Object.fromEntries(rows.map((r) => [r[key], r.status]));
    expect(status(d.districts, 'district_code')).toEqual({ PUN: 'ACTIVE', NSK: 'ACTIVE', AHM: 'INACTIVE', RMV: 'INACTIVE' });
    expect(status(d.centres, 'centre_code')).toEqual({ PNC1: 'ACTIVE', NRC1: 'ACTIVE', AHC1: 'INACTIVE', OLD1: 'INACTIVE' });
    const tracks = status(d.tracks, 'track_code');
    expect(Object.keys(tracks)).toHaveLength(14);
    expect(tracks).toMatchObject({ T01: 'ACTIVE', T12: 'ACTIVE', [INACTIVE_TRACK]: 'INACTIVE', [DELETED_TRACK]: 'INACTIVE' });
  });

  it('sends each record in the API-122 shape, with the centre profile fields', async () => {
    const d = await pull();
    expect(d.districts.find((r) => r.district_code === 'PUN')).toEqual({
      district_id: ids.pune,
      district_code: 'PUN',
      name_en: 'Pune',
      name_mr: null,
      status: 'ACTIVE',
      updated_at: expect.any(String),
    });
    expect(d.centres.find((r) => r.centre_code === 'PNC1')).toEqual({
      centre_id: ids.puneCentre,
      centre_code: 'PNC1',
      district_code: 'PUN',
      district_name: 'Pune',
      name: 'Pune Main Centre',
      centre_type: 'Owned',
      taluka: 'Haveli',
      readiness_status: null,
      max_seating_capacity: 40,
      computer_systems: 30,
      tracks_offered: null,
      status: 'ACTIVE',
      updated_at: expect.any(String),
    });
    expect(d.centres.find((r) => r.centre_code === 'OLD1')).toMatchObject({
      centre_id: ids.oldCentre,
      district_code: 'NSK',
      district_name: 'Nashik',
      centre_type: null,
      taluka: null,
      max_seating_capacity: null,
    });
    expect(d.tracks.find((r) => r.track_code === 'T01')).toEqual({
      track_id: expect.any(String),
      track_code: 'T01',
      name: expect.any(String),
      name_mr: null,
      sort_order: 1,
      status: 'ACTIVE',
      updated_at: expect.any(String),
    });
  });

  it('orders each list by (createdAt, id), a key no edit changes', async () => {
    const d = await pull();
    const source = {
      districts: ['districts', 'district_id'],
      centres: ['training_centres', 'centre_id'],
      tracks: ['technology_tracks', 'track_id'],
    };
    for (const list of LISTS) {
      const [table, idKey] = source[list];
      /* Every row of these small tables is on the one full page, deleted rows included. */
      const rows: { id: string }[] = await AppDataSource.query(`SELECT "id" FROM "${table}" ORDER BY "createdAt", "id"`);
      expect(d[list].map((r) => r[idKey])).toEqual(rows.map((r) => r.id));
    }
  });

  it('pages every list by the same page, with has_more while any list goes on', async () => {
    const full = await pull();
    const got: Record<(typeof LISTS)[number], Row[]> = { districts: [], centres: [], tracks: [] };
    let page = 1;
    let last: Pull;
    do {
      last = await pull(`?page=${page}&page_size=2`);
      expect(last).toMatchObject({ page, page_size: 2 });
      for (const list of LISTS) {
        expect(last[list].length).toBeLessThanOrEqual(2);
        got[list].push(...last[list]);
      }
      page++;
    } while (last.has_more && page < 20);
    /* 14 tracks at 2 a page: page 7 is the last, and districts and centres ran out on page 2. */
    expect(page - 1).toBe(7);
    expect(last.has_more).toBe(false);
    for (const list of LISTS) expect(got[list]).toEqual(full[list]);
    const beyond = await pull('?page=8&page_size=2');
    expect(beyond).toMatchObject({ districts: [], centres: [], tracks: [], has_more: false });
  });

  it('keeps only rows changed at or after updated_since', async () => {
    const full = await pull();
    const times = LISTS.flatMap((list) => full[list].map((r) => r.updated_at)).sort();
    const cutoff = times[Math.floor(times.length / 2)];
    const since = await pull(`?updated_since=${encodeURIComponent(cutoff)}`);
    for (const list of LISTS) expect(since[list]).toEqual(full[list].filter((r) => r.updated_at >= cutoff));
    expect(LISTS.reduce((n, list) => n + since[list].length, 0)).toBeGreaterThan(0);

    const future = await pull(`?updated_since=${encodeURIComponent('2999-01-01T00:00:00Z')}`);
    expect(future).toMatchObject({ districts: [], centres: [], tracks: [], has_more: false });
    expect(codes((await pull('?updated_since=1970-01-01T00:00:00Z')).centres, 'centre_code')).toEqual(codes(full.centres, 'centre_code'));
  });

  it('rejects an invalid page, page_size or updated_since (422)', async () => {
    for (const qs of ['page=0', 'page_size=501', 'updated_since=yesterday'])
      expect((await signed('get', `${PATH}?${qs}`)).status).toBe(422);
  });

  it('has no write path: other methods answer 404 and a pull changes no row', async () => {
    const state = () =>
      AppDataSource.query(
        `SELECT (SELECT count(*) FROM "districts")::int AS districts, (SELECT max("updatedAt") FROM "districts") AS d,
                (SELECT count(*) FROM "training_centres")::int AS centres, (SELECT max("updatedAt") FROM "training_centres") AS c,
                (SELECT count(*) FROM "centre_infrastructure")::int AS infra, (SELECT max("updatedAt") FROM "centre_infrastructure") AS i,
                (SELECT count(*) FROM "technology_tracks")::int AS tracks, (SELECT max("updatedAt") FROM "technology_tracks") AS t`,
      );
    const before = await state();
    for (const method of ['post', 'put', 'patch', 'delete'] as const) expect((await signed(method, PATH)).status).toBe(404);
    await pull();
    await pull('?page=2&page_size=1');
    expect(await state()).toEqual(before);
  });

  it('skips no row when a row of an earlier page is edited between two page requests', async () => {
    /* Each page is its own snapshot, and lms-api sets every row missing from a full pull INACTIVE. */
    const full = await pull();
    const first = await pull('?page=1&page_size=2');
    await call('patch', `/cms/districts/${first.districts[0].district_id as string}`, { name: 'Edited Mid Pull District' });
    await call('patch', `/cms/training-centres/${first.centres[0].centre_id as string}`, { name: 'Edited Mid Pull Centre' });
    const second = await pull('?page=2&page_size=2');
    const lists = { districts: 'district_code', centres: 'centre_code' } as const;
    for (const [list, key] of Object.entries(lists) as [keyof typeof lists, string][]) {
      expect(first[list].length + second[list].length).toBe(full[list].length);
      expect(codes([...first[list], ...second[list]], key).sort()).toEqual(codes(full[list], key).sort());
    }
  });
});
