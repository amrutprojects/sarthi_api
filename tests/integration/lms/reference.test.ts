import type { Express } from 'express';
import { API, AppDataSource, actorWith, auth, request, setupTestApp, superAdmin, teardownTestApp, type TestActor } from '../../helpers/test-app';

/*
 * LMS Admin — Reference Data (UI-314), read-only. The Admin Panel's districts, training centres and technology
 * tracks are built through the CMS API (the Admin Panel's own write path) and read back through /lms/reference.
 */

let app: Express;
let admin: TestActor;
let viewer: TestActor;

/* technology_tracks is seeded by its migration and kept between test files, so the fixture tracks (one inactive,
 * one soft-deleted) are removed before and after this file (never a seeded T01–T12 row). */
const FIXTURE_TRACK = 'T99';
const DELETED_TRACK = 'T98';
const removeFixtureTrack = () =>
  AppDataSource.query(`DELETE FROM "technology_tracks" WHERE "code" = ANY($1)`, [[FIXTURE_TRACK, DELETED_TRACK]]);

const ids: Record<string, string> = {};

async function post(path: string, body: Record<string, unknown>): Promise<{ id: string }> {
  const res = await request(app).post(`${API}${path}`).set(auth(admin.token)).send(body);
  if (res.status !== 201) throw new Error(`POST ${path} failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data as { id: string };
}

async function call(method: 'patch' | 'delete', path: string, body?: Record<string, unknown>): Promise<void> {
  const res = await request(app)[method](`${API}${path}`).set(auth(admin.token)).send(body);
  if (res.status !== 200) throw new Error(`${method.toUpperCase()} ${path} failed (${res.status}): ${JSON.stringify(res.body)}`);
}

const get = (path: string, token = viewer.token) => request(app).get(`${API}/lms/reference${path}`).set(auth(token));

beforeAll(async () => {
  app = await setupTestApp();
  await removeFixtureTrack();
  admin = await superAdmin();
  viewer = await actorWith(['lms-reference.view']);

  /* Admin Panel geography: one state, three live districts (one deactivated) and one deleted district. */
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
      districtId: ids.pune, name: 'Pune Main Centre', code: 'PNC1', centreTypeId: ids.owned, talukaId: ids.haveli,
    })
  ).id;
  ids.nashikCentre = (await post('/cms/training-centres', { districtId: ids.nashik, name: 'Nashik Road Centre', code: 'NRC1' })).id;
  ids.ahmCentre = (
    await post('/cms/training-centres', { districtId: ids.ahmednagar, name: 'Ahmednagar Centre', code: 'AHC1', isActive: false })
  ).id;
  ids.oldCentre = (await post('/cms/training-centres', { districtId: ids.nashik, name: 'Old Closed Centre', code: 'OLD1' })).id;
  await call('delete', `/cms/training-centres/${ids.oldCentre}`);
  ids.infra = (await post('/cms/centre-infrastructure', { centreId: ids.puneCentre, maxSeatingCapacity: 40, computerSystems: 30 })).id;

  /* Deactivated after its centre was created (deactivation is never blocked in the Admin Panel). */
  await call('patch', `/cms/districts/${ids.ahmednagar}/status`, { isActive: false });

  /* An inactive technology track next to the twelve seeded active ones. */
  await AppDataSource.query(
    `INSERT INTO "technology_tracks" ("code", "name", "aliases", "sortOrder", "isActive") VALUES ($1, 'Reference Fixture Track', '["Fixture Alias"]', 99, false)`,
    [FIXTURE_TRACK],
  );
  /* ...and a track the Admin Panel has soft-deleted: it must not appear anywhere in the LMS. */
  await AppDataSource.query(
    `INSERT INTO "technology_tracks" ("code", "name", "aliases", "sortOrder", "isActive", "isDelete")
     VALUES ($1, 'Deleted Fixture Track', '["Deleted Alias"]', 98, false, true)`,
    [DELETED_TRACK],
  );
});

afterAll(async () => {
  if (AppDataSource.isInitialized) await removeFixtureTrack();
  await teardownTestApp();
});

describe('GET /lms/reference/summary', () => {
  it('counts each dataset from the Admin Panel tables and reports the live source', async () => {
    const res = await get('/summary');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.districts).toMatchObject({ total: 3, active: 2, inactive: 1 });
    expect(d.centres).toMatchObject({ total: 3, active: 2, inactive: 1 });
    expect(d.tracks).toMatchObject({ total: 13, active: 12, inactive: 1 });
    expect(d.sync).toEqual({ mode: 'LIVE', source: 'Admin Panel (same database)' });
    for (const k of ['districts', 'centres', 'tracks']) expect(typeof d[k].sourceUpdatedAt).toBe('string');
  });

  it('dates the centres dataset by the latest centre or capacity & infrastructure change', async () => {
    const [row]: { max: Date }[] = await AppDataSource.query(
      `SELECT GREATEST((SELECT max("updatedAt") FROM "training_centres"), (SELECT max("updatedAt") FROM "centre_infrastructure")) AS max`,
    );
    const res = await get('/summary');
    expect(new Date(res.body.data.centres.sourceUpdatedAt).getTime()).toBe(new Date(row.max).getTime());
  });
});

describe('GET /lms/reference/districts', () => {
  it('lists non-deleted districts A–Z with their state, status and source update time', async () => {
    const res = await get('/districts');
    expect(res.status).toBe(200);
    expect(res.body.data.map((r: { name: string }) => r.name)).toEqual(['Ahmednagar', 'Nashik', 'Pune']);
    expect(res.body.data[2]).toMatchObject({
      id: ids.pune, code: 'PUN', name: 'Pune', stateId: ids.state, stateName: 'Maharashtra', stateCode: 'MH', stateIsActive: true, isActive: true,
    });
    expect(typeof res.body.data[2].sourceUpdatedAt).toBe('string');
    expect(res.body.meta).toEqual({ page: 1, limit: 10, total: 3, totalPages: 1 });
  });

  it('searches name, code and state name', async () => {
    expect((await get('/districts?search=nas')).body.data.map((r: { code: string }) => r.code)).toEqual(['NSK']);
    expect((await get('/districts?search=PUN')).body.data.map((r: { code: string }) => r.code)).toEqual(['PUN']);
    expect((await get('/districts?search=maharash')).body.meta.total).toBe(3);
    expect((await get('/districts?search=zzz')).body.data).toEqual([]);
  });

  it('filters by status', async () => {
    expect((await get('/districts?isActive=false')).body.data.map((r: { code: string }) => r.code)).toEqual(['AHM']);
    expect((await get('/districts?isActive=true')).body.meta.total).toBe(2);
  });

  it('sorts and pages', async () => {
    expect((await get('/districts?sortBy=code&sortOrder=desc')).body.data.map((r: { code: string }) => r.code)).toEqual(['PUN', 'NSK', 'AHM']);
    const page2 = await get('/districts?limit=2&page=2');
    expect(page2.body.data.map((r: { code: string }) => r.code)).toEqual(['PUN']);
    expect(page2.body.meta).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
  });

  it('rejects an unknown sort field and an oversized page (422)', async () => {
    const bad = await get('/districts?sortBy=isDelete');
    expect(bad.status).toBe(422);
    expect(bad.body.error.details[0].field).toBe('query.sortBy');
    expect((await get('/districts?limit=101')).status).toBe(422);
  });
});

describe('GET /lms/reference/centres', () => {
  it('lists non-deleted centres with district, centre type, taluka, capacity and computer systems', async () => {
    const res = await get('/centres');
    expect(res.status).toBe(200);
    expect(res.body.data.map((r: { code: string }) => r.code)).toEqual(['AHC1', 'NRC1', 'PNC1']);
    const pune = res.body.data[2];
    expect(pune).toMatchObject({
      id: ids.puneCentre,
      name: 'Pune Main Centre',
      districtId: ids.pune,
      districtName: 'Pune',
      districtCode: 'PUN',
      districtIsActive: true,
      stateName: 'Maharashtra',
      centreTypeName: 'Owned',
      talukaName: 'Haveli',
      maxSeatingCapacity: 40,
      computerSystems: 30,
      isActive: true,
    });
    expect(res.body.data[1]).toMatchObject({ code: 'NRC1', centreTypeName: null, talukaName: null, maxSeatingCapacity: null, computerSystems: null });
    expect(res.body.data[0]).toMatchObject({ code: 'AHC1', isActive: false, districtIsActive: false });
  });

  it('gives each centre the later of its own and its infrastructure record update times', async () => {
    const [row]: { t: Date }[] = await AppDataSource.query(
      `SELECT GREATEST(tc."updatedAt", ci."updatedAt") AS t FROM "training_centres" tc JOIN "centre_infrastructure" ci ON ci."centreId" = tc.id WHERE tc.id = $1`,
      [ids.puneCentre],
    );
    const pune = (await get('/centres?search=PNC1')).body.data[0];
    expect(new Date(pune.sourceUpdatedAt).getTime()).toBe(new Date(row.t).getTime());
  });

  it('searches name, code, district, taluka and centre type', async () => {
    const codes = async (q: string) => (await get(`/centres?search=${q}`)).body.data.map((r: { code: string }) => r.code);
    expect(await codes('nashik')).toEqual(['NRC1']);
    expect(await codes('haveli')).toEqual(['PNC1']);
    expect(await codes('owned')).toEqual(['PNC1']);
    expect(await codes('ahc')).toEqual(['AHC1']);
    expect(await codes('closed')).toEqual([]);
  });

  it('filters by status, sorts on parent names and pages', async () => {
    expect((await get('/centres?isActive=false')).body.data.map((r: { code: string }) => r.code)).toEqual(['AHC1']);
    expect((await get('/centres?isActive=true')).body.meta.total).toBe(2);
    expect((await get('/centres?sortBy=districtName&sortOrder=desc')).body.data.map((r: { code: string }) => r.code)).toEqual(['PNC1', 'NRC1', 'AHC1']);
    /* Centres without a taluka stay at the end whichever way the column is sorted. */
    expect((await get('/centres?sortBy=talukaName&sortOrder=asc')).body.data[0].code).toBe('PNC1');
    expect((await get('/centres?sortBy=talukaName&sortOrder=desc')).body.data[0].code).toBe('PNC1');
    /* Source update time = GREATEST(centre, infrastructure): PNC1's infrastructure record is the latest change. */
    const bySource = await get('/centres?sortBy=updatedAt&sortOrder=desc');
    expect(bySource.status).toBe(200);
    expect(bySource.body.data.map((r: { code: string }) => r.code)).toEqual(['PNC1', 'AHC1', 'NRC1']);
    const page = await get('/centres?limit=1&page=3');
    expect(page.body.data.map((r: { code: string }) => r.code)).toEqual(['PNC1']);
    expect(page.body.meta).toEqual({ page: 3, limit: 1, total: 3, totalPages: 3 });
    expect((await get('/centres?sortBy=capacity')).status).toBe(422);
  });
});

describe('GET /lms/reference/tracks', () => {
  it('lists the Admin Panel technology tracks in their order', async () => {
    const res = await get('/tracks?limit=100');
    expect(res.status).toBe(200);
    const codes = res.body.data.map((r: { code: string }) => r.code);
    expect(codes).toEqual(['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08', 'T09', 'T10', 'T11', 'T12', FIXTURE_TRACK]);
    expect(res.body.data[6]).toMatchObject({ code: 'T07', name: 'Cyber Security', sortOrder: 7, isActive: true, aliases: ['Cyber Security'] });
    expect(typeof res.body.data[6].sourceUpdatedAt).toBe('string');
  });

  it('searches code, name and registration-form aliases', async () => {
    const codes = async (q: string) => (await get(`/tracks?search=${encodeURIComponent(q)}`)).body.data.map((r: { code: string }) => r.code);
    expect(await codes('cyber')).toEqual(['T07']);
    expect(await codes('AI-ML')).toEqual(['T08']);
    expect(await codes('t12')).toEqual(['T12']);
  });

  it('matches each alias on its own, never the JSON punctuation around the aliases', async () => {
    const codes = async (q: string) => (await get(`/tracks?search=${encodeURIComponent(q)}`)).body.data.map((r: { code: string }) => r.code);
    expect(await codes('fixture alias')).toEqual([FIXTURE_TRACK]);
    expect(await codes('Social Media & Digital')).toEqual(['T10']);
    for (const q of ['[', '"', ',', '", "']) expect([q, await codes(q)]).toEqual([q, []]);
  });

  it('filters by status and sorts by name', async () => {
    expect((await get('/tracks?isActive=false')).body.data.map((r: { code: string }) => r.code)).toEqual([FIXTURE_TRACK]);
    expect((await get('/tracks?isActive=true')).body.meta.total).toBe(12);
    expect((await get('/tracks?sortBy=name&limit=1')).body.data[0].code).toBe('T08');
    expect((await get('/tracks?sortBy=code&sortOrder=desc&limit=1')).body.data[0].code).toBe(FIXTURE_TRACK);
  });

  it('pages and rejects an unknown sort field (422)', async () => {
    const page2 = await get('/tracks?limit=5&page=2');
    expect(page2.body.data.map((r: { code: string }) => r.code)).toEqual(['T06', 'T07', 'T08', 'T09', 'T10']);
    expect(page2.body.meta).toEqual({ page: 2, limit: 5, total: 13, totalPages: 3 });
    const bad = await get('/tracks?sortBy=aliases');
    expect(bad.status).toBe(422);
    expect(bad.body.error.details[0].field).toBe('query.sortBy');
    expect((await get('/tracks?isActive=yes')).status).toBe(422);
  });

  it('never shows a track the Admin Panel soft-deleted (list, search, summary, dropdown)', async () => {
    expect((await get('/tracks?limit=100')).body.data.map((r: { code: string }) => r.code)).not.toContain(DELETED_TRACK);
    expect((await get('/tracks?search=deleted')).body.data).toEqual([]);
    expect((await get('/tracks?isActive=false')).body.meta.total).toBe(1);
    expect((await get('/summary')).body.data.tracks).toMatchObject({ total: 13, inactive: 1 });
    expect((await get('/options/tracks')).body.data.map((r: { code: string }) => r.code)).not.toContain(DELETED_TRACK);
  });
});

describe('R1 dropdown feeds', () => {
  it('GET /options/centres: active centres A–Z with their district', async () => {
    const res = await get('/options/centres');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { id: ids.nashikCentre, name: 'Nashik Road Centre', code: 'NRC1', districtName: 'Nashik' },
      { id: ids.puneCentre, name: 'Pune Main Centre', code: 'PNC1', districtName: 'Pune' },
    ]);
  });

  it('GET /options/tracks: active tracks in sortOrder, { id, name, code } only', async () => {
    const res = await get('/options/tracks');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(12);
    expect(res.body.data.map((r: { code: string }) => r.code)[0]).toBe('T01');
    expect(res.body.data.map((r: { code: string }) => r.code)).not.toContain(FIXTURE_TRACK);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['code', 'id', 'name']);
  });

  it('is readable with the view permission of any LMS master that picks a centre or track', async () => {
    for (const code of ['lms-entities.view', 'lms-calendars.view', 'lms-course-modules.view', 'lms-track-variants.view']) {
      const actor = await actorWith([code]);
      expect((await get('/options/centres', actor.token)).status).toBe(200);
      expect((await get('/options/tracks', actor.token)).status).toBe(200);
      /* ...which does not open the Reference Data screen itself. */
      expect((await get('/districts', actor.token)).status).toBe(403);
    }
  });

  it('?entityId= narrows both feeds to what the entity enabled, readable without lms-entities.view', async () => {
    const tracks = (await get('/options/tracks')).body.data as { id: string; code: string }[];
    const t03 = tracks.find((t) => t.code === 'T03')!.id;
    const t07 = tracks.find((t) => t.code === 'T07')!.id;
    const entity = await post('/lms/entities', {
      name: 'Feed Entity', code: 'FEED', defaultLanguage: 'en', centreIds: [ids.puneCentre], trackIds: [t07, t03],
    });
    /* A calendar manager (no Entity Master permission) sees only the enabled rows (Nashik is active but not enabled), in feed order. */
    const calendarViewer = await actorWith(['lms-calendars.view']);
    const centres = await get(`/options/centres?entityId=${entity.id}`, calendarViewer.token);
    expect(centres.status).toBe(200);
    expect(centres.body.data.map((r: { code: string }) => r.code)).toEqual(['PNC1']);
    const enabledTracks = await get(`/options/tracks?entityId=${entity.id}`, calendarViewer.token);
    expect(enabledTracks.body.data.map((r: { code: string }) => r.code)).toEqual(['T03', 'T07']);
    /* An unknown entity enables nothing; a malformed id is a 422; unknown query keys are refused. */
    expect((await get('/options/centres?entityId=00000000-0000-4000-8000-000000000000')).body.data).toEqual([]);
    expect((await get('/options/tracks?entityId=nope')).status).toBe(422);
    expect((await get('/options/tracks?other=1')).status).toBe(422);
    await call('delete', `/lms/entities/${entity.id}`);
  });
});

describe('access control', () => {
  it('401 without a session, on every route', async () => {
    for (const path of ['/summary', '/districts', '/centres', '/tracks', '/options/centres', '/options/tracks']) {
      const res = await request(app).get(`${API}/lms/reference${path}`);
      expect([path, res.status]).toEqual([path, 401]);
    }
  });

  it('403 without lms-reference.view (a CMS viewer or an unrelated LMS menu)', async () => {
    for (const codes of [['cms-districts.view', 'cms-training-centres.view'], ['lms-branding.view']]) {
      const actor = await actorWith(codes);
      for (const path of ['/summary', '/districts', '/centres', '/tracks', '/options/centres', '/options/tracks']) {
        const res = await get(path, actor.token);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    }
  });
});

describe('read-only', () => {
  const paths = ['/summary', '/districts', '/centres', '/tracks', '/options/centres', '/options/tracks'];

  it('has no write route: POST / PUT / PATCH / DELETE answer 404 even for a Super Admin', async () => {
    for (const path of paths) {
      for (const method of ['post', 'put', 'patch', 'delete'] as const) {
        const res = await request(app)[method](`${API}/lms/reference${path}`).set(auth(admin.token)).send({ name: 'x' });
        expect([method, path, res.status]).toEqual([method, path, 404]);
      }
    }
    for (const [path, id] of [['/districts', ids.pune], ['/centres', ids.puneCentre], ['/tracks', ids.puneCentre]]) {
      for (const method of ['put', 'patch', 'delete'] as const) {
        const res = await request(app)[method](`${API}/lms/reference${path}/${id}`).set(auth(admin.token)).send({ isActive: false });
        expect([method, path, res.status]).toEqual([method, path, 404]);
      }
    }
  });

  it('leaves the Admin Panel rows untouched', async () => {
    const res = await get('/centres?search=PNC1');
    expect(res.body.data[0]).toMatchObject({ name: 'Pune Main Centre', isActive: true, maxSeatingCapacity: 40 });
    const [{ n }]: { n: number }[] = await AppDataSource.query(`SELECT count(*)::int AS n FROM "technology_tracks" WHERE "isDelete" = false AND "isActive" = true`);
    expect(n).toBe(12);
  });
});

/* Runs last: it changes the Admin Panel fixtures the blocks above read. */
describe('live source (same database, no copy to synchronise)', () => {
  it('shows an Admin Panel change on the next read: renamed and deactivated centre, deactivated state', async () => {
    const before = (await get('/centres?search=NRC1')).body.data[0].sourceUpdatedAt as string;
    await call('patch', `/cms/training-centres/${ids.nashikCentre}`, { name: 'Nashik Road Training Centre' });
    await call('patch', `/cms/training-centres/${ids.nashikCentre}/status`, { isActive: false });
    await call('patch', `/cms/states/${ids.state}/status`, { isActive: false });

    const centre = (await get('/centres?search=NRC1')).body.data[0];
    expect(centre).toMatchObject({ name: 'Nashik Road Training Centre', isActive: false });
    expect(new Date(centre.sourceUpdatedAt).getTime()).toBeGreaterThan(new Date(before).getTime());
    expect((await get('/districts?search=PUN')).body.data[0]).toMatchObject({ code: 'PUN', stateIsActive: false });
    /* The picker drops the deactivated centre at once (F-LMS-03-04: ACTIVE rows only). */
    expect((await get('/options/centres')).body.data.map((r: { code: string }) => r.code)).toEqual(['PNC1']);
    expect((await get('/summary')).body.data.centres).toMatchObject({ total: 3, active: 1, inactive: 2 });
  });
});
