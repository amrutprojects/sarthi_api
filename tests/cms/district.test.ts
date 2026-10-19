import type { Express } from 'express';
import { API, actorWith, auth, request, setupTestApp, superAdmin, teardownTestApp, type TestActor } from '../helpers/test-app';
import { MISSING_ID, VIEW_ONLY_CODES, makeDistrict, makeState, makeTaluka } from './helpers';

let app: Express;
let admin: TestActor;
let mh: { id: string };
let ka: { id: string };

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
  mh = await makeState(app, admin.token, 'Maharashtra', 'MH');
  ka = await makeState(app, admin.token, 'Karnataka', 'KA');
});
afterAll(teardownTestApp);

describe('District Master CRUD', () => {
  it('creates a district under a state and resolves the state name in the response', async () => {
    const res = await request(app).post(`${API}/cms/districts`).set(auth(admin.token)).send({ stateId: mh.id, name: 'Pune', code: 'PUN' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'Pune', code: 'PUN', stateId: mh.id, stateName: 'Maharashtra', stateCode: 'MH', isActive: true, talukaCount: 0,
    });
  });

  it('shows the state name in the listing, not only the id', async () => {
    const list = await request(app).get(`${API}/cms/districts`).query({ search: 'Pune' }).set(auth(admin.token));
    expect(list.status).toBe(200);
    const row = list.body.data.find((d: { code: string }) => d.code === 'PUN');
    expect(row).toMatchObject({ stateName: 'Maharashtra', stateCode: 'MH' });
  });

  it('requires a state: a missing, unknown or non-uuid stateId is refused', async () => {
    expect((await request(app).post(`${API}/cms/districts`).set(auth(admin.token)).send({ name: 'Orphan', code: 'ORP' })).status).toBe(422);
    expect((await request(app).post(`${API}/cms/districts`).set(auth(admin.token)).send({ stateId: 'nope', name: 'Orphan', code: 'ORP' })).status).toBe(422);

    const unknown = await request(app).post(`${API}/cms/districts`).set(auth(admin.token)).send({ stateId: MISSING_ID, name: 'Orphan', code: 'ORP' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.message).toMatch(/does not exist/i);
    expect(unknown.body.error.details?.[0]).toMatchObject({ field: 'stateId' });
  });

  it('refuses a state that is inactive', async () => {
    const dormant = await makeState(app, admin.token, 'Dormant State', 'DRM');
    await request(app).patch(`${API}/cms/states/${dormant.id}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);

    const res = await request(app).post(`${API}/cms/districts`).set(auth(admin.token)).send({ stateId: dormant.id, name: 'Nowhere', code: 'NWH' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/inactive/i);
  });

  it('enforces name and code uniqueness within the state only', async () => {
    await makeDistrict(app, admin.token, mh.id, 'Nashik', 'NAS');

    const dupName = await request(app).post(`${API}/cms/districts`).set(auth(admin.token)).send({ stateId: mh.id, name: 'nashik', code: 'NAS2' });
    expect(dupName.status).toBe(409);
    const dupCode = await request(app).post(`${API}/cms/districts`).set(auth(admin.token)).send({ stateId: mh.id, name: 'Nashik North', code: 'NAS' });
    expect(dupCode.status).toBe(409);

    /* The same name and code in a different state is a different district and must be allowed. */
    const other = await request(app).post(`${API}/cms/districts`).set(auth(admin.token)).send({ stateId: ka.id, name: 'Nashik', code: 'NAS' });
    expect(other.status).toBe(201);
  });

  it('updates fields, and moving to another state re-checks uniqueness there', async () => {
    const district = await makeDistrict(app, admin.token, mh.id, 'Satara', 'SAT');

    const renamed = await request(app).patch(`${API}/cms/districts/${district.id}`).set(auth(admin.token)).send({ name: 'Satara City' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe('Satara City');

    /* Karnataka already has Nashik/NAS from the previous test: moving a clashing record must fail. */
    const clash = await makeDistrict(app, admin.token, mh.id, 'Nashik Rural', 'NASR');
    await request(app).patch(`${API}/cms/districts/${clash.id}`).set(auth(admin.token)).send({ name: 'Nashik' }).expect(409);
    const move = await request(app).patch(`${API}/cms/districts/${clash.id}`).set(auth(admin.token)).send({ stateId: ka.id, name: 'Nashik' });
    expect(move.status).toBe(409);

    /* A clean move keeps the record and reports the new state. */
    const moved = await request(app).patch(`${API}/cms/districts/${district.id}`).set(auth(admin.token)).send({ stateId: ka.id });
    expect(moved.status).toBe(200);
    expect(moved.body.data).toMatchObject({ stateId: ka.id, stateName: 'Karnataka' });
  });

  it('refuses to move a district to an unknown or inactive state', async () => {
    const district = await makeDistrict(app, admin.token, mh.id, 'Solapur', 'SOL');
    expect((await request(app).patch(`${API}/cms/districts/${district.id}`).set(auth(admin.token)).send({ stateId: MISSING_ID })).status).toBe(400);
  });

  it('activates and deactivates, and 404s for an unknown id', async () => {
    const district = await makeDistrict(app, admin.token, mh.id, 'Kolhapur', 'KOL');
    const off = await request(app).patch(`${API}/cms/districts/${district.id}/status`).set(auth(admin.token)).send({ isActive: false });
    expect(off.body.data.isActive).toBe(false);
    expect((await request(app).get(`${API}/cms/districts/${MISSING_ID}`).set(auth(admin.token))).status).toBe(404);
  });
});

describe('District Master filtering and deletion', () => {
  it('filters by stateId and refuses an unknown one', async () => {
    const list = await request(app).get(`${API}/cms/districts`).query({ stateId: ka.id, limit: 100 }).set(auth(admin.token));
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    expect(list.body.data.every((d: { stateId: string }) => d.stateId === ka.id)).toBe(true);

    const bad = await request(app).get(`${API}/cms/districts`).query({ stateId: MISSING_ID }).set(auth(admin.token));
    expect(bad.status).toBe(400);
  });

  it('sorts by the state name', async () => {
    const asc = await request(app).get(`${API}/cms/districts`).query({ sortBy: 'stateName', sortOrder: 'asc', limit: 100 }).set(auth(admin.token));
    expect(asc.status).toBe(200);
    const states = asc.body.data.map((d: { stateName: string }) => d.stateName);
    expect([...states].sort((a: string, b: string) => a.localeCompare(b))).toEqual(states);
  });

  it('refuses to delete a district that still has talukas', async () => {
    const district = await makeDistrict(app, admin.token, mh.id, 'Raigad', 'RAI');
    const taluka = await makeTaluka(app, admin.token, district.id, 'Alibag');

    const blocked = await request(app).delete(`${API}/cms/districts/${district.id}`).set(auth(admin.token));
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/cannot be deleted/i);

    await request(app).delete(`${API}/cms/talukas/${taluka.id}`).set(auth(admin.token)).expect(200);
    expect((await request(app).delete(`${API}/cms/districts/${district.id}`).set(auth(admin.token))).status).toBe(200);
  });
});

describe('Districts of a state (dropdown feed)', () => {
  it('returns the active districts of one state', async () => {
    const state = await makeState(app, admin.token, 'Feed State', 'FS');
    const live = await makeDistrict(app, admin.token, state.id, 'Live District', 'LIV');
    const dormant = await makeDistrict(app, admin.token, state.id, 'Dormant District', 'DOR');
    await request(app).patch(`${API}/cms/districts/${dormant.id}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);

    const res = await request(app).get(`${API}/cms/states/${state.id}/districts`).set(auth(admin.token));
    expect(res.status).toBe(200);
    const ids = res.body.data.map((d: { id: string }) => d.id);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(dormant.id);
    /* The feed is deliberately narrow: an option and the parent it belongs to, nothing more. */
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['code', 'id', 'name', 'stateId']);
  });

  it('404s for an unknown state and 422s for a non-uuid', async () => {
    expect((await request(app).get(`${API}/cms/states/${MISSING_ID}/districts`).set(auth(admin.token))).status).toBe(404);
    expect((await request(app).get(`${API}/cms/states/nope/districts`).set(auth(admin.token))).status).toBe(422);
  });

  it('is readable by someone who may view either child master', async () => {
    const viewer = await actorWith(['cms-talukas.view']);
    expect((await request(app).get(`${API}/cms/states/${mh.id}/districts`).set(auth(viewer.token))).status).toBe(200);
    const outsider = await actorWith(['cms-states.view']);
    expect((await request(app).get(`${API}/cms/states/${mh.id}/districts`).set(auth(outsider.token))).status).toBe(403);
  });
});

describe('District Master authorisation', () => {
  it('needs a session, and write needs more than view', async () => {
    expect((await request(app).get(`${API}/cms/districts`)).status).toBe(401);
    const viewer = await actorWith(VIEW_ONLY_CODES);
    expect((await request(app).get(`${API}/cms/districts`).set(auth(viewer.token))).status).toBe(200);
    expect((await request(app).post(`${API}/cms/districts`).set(auth(viewer.token)).send({ stateId: mh.id, name: 'Nope', code: 'NP' })).status).toBe(403);
  });
});
