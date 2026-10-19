import type { Express } from 'express';
import { API, actorWith, auth, request, setupTestApp, superAdmin, teardownTestApp, type TestActor } from '../helpers/test-app';
import { MISSING_ID, VIEW_ONLY_CODES, makeDistrict, makeState, makeTaluka } from './helpers';

let app: Express;
let admin: TestActor;
let mh: { id: string };
let ka: { id: string };
/* Pune and Nashik are in Maharashtra; Belagavi is in Karnataka. */
let pune: { id: string };
let nashik: { id: string };
let belagavi: { id: string };

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
  mh = await makeState(app, admin.token, 'Maharashtra', 'MH');
  ka = await makeState(app, admin.token, 'Karnataka', 'KA');
  pune = await makeDistrict(app, admin.token, mh.id, 'Pune', 'PUN');
  nashik = await makeDistrict(app, admin.token, mh.id, 'Nashik', 'NAS');
  belagavi = await makeDistrict(app, admin.token, ka.id, 'Belagavi', 'BGM');
});
afterAll(teardownTestApp);

describe('Taluka Master CRUD', () => {
  it('creates a taluka under a district and resolves both parents in the response', async () => {
    const res = await request(app).post(`${API}/cms/talukas`).set(auth(admin.token)).send({ districtId: pune.id, name: 'Haveli', code: 'HVL' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'Haveli',
      code: 'HVL',
      districtId: pune.id,
      districtName: 'Pune',
      districtCode: 'PUN',
      /* The state is derived through the district, never stored on the taluka. */
      stateId: mh.id,
      stateName: 'Maharashtra',
      stateCode: 'MH',
      isActive: true,
    });
  });

  it('accepts a taluka without a code, and treats an empty code as none', async () => {
    const noCode = await request(app).post(`${API}/cms/talukas`).set(auth(admin.token)).send({ districtId: pune.id, name: 'Mulshi' });
    expect(noCode.status).toBe(201);
    expect(noCode.body.data.code).toBeNull();

    const blank = await request(app).post(`${API}/cms/talukas`).set(auth(admin.token)).send({ districtId: pune.id, name: 'Velhe', code: '' });
    expect(blank.status).toBe(201);
    expect(blank.body.data.code).toBeNull();

    /* Several talukas without a code must not collide on the partial unique index. */
    const second = await request(app).post(`${API}/cms/talukas`).set(auth(admin.token)).send({ districtId: pune.id, name: 'Bhor' });
    expect(second.status).toBe(201);
  });

  it('requires a district: missing, unknown, non-uuid or inactive is refused', async () => {
    expect((await request(app).post(`${API}/cms/talukas`).set(auth(admin.token)).send({ name: 'Orphan' })).status).toBe(422);
    expect((await request(app).post(`${API}/cms/talukas`).set(auth(admin.token)).send({ districtId: 'nope', name: 'Orphan' })).status).toBe(422);

    const unknown = await request(app).post(`${API}/cms/talukas`).set(auth(admin.token)).send({ districtId: MISSING_ID, name: 'Orphan' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.details?.[0]).toMatchObject({ field: 'districtId' });

    const dormant = await makeDistrict(app, admin.token, mh.id, 'Dormant District', 'DOR');
    await request(app).patch(`${API}/cms/districts/${dormant.id}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);
    const inactive = await request(app).post(`${API}/cms/talukas`).set(auth(admin.token)).send({ districtId: dormant.id, name: 'Nowhere' });
    expect(inactive.status).toBe(400);
    expect(inactive.body.message).toMatch(/inactive/i);
  });

  it('enforces name uniqueness within the district only', async () => {
    await makeTaluka(app, admin.token, nashik.id, 'Igatpuri', 'IGT');
    const dup = await request(app).post(`${API}/cms/talukas`).set(auth(admin.token)).send({ districtId: nashik.id, name: 'igatpuri' });
    expect(dup.status).toBe(409);

    /* Same name in another district is a different taluka. */
    const other = await request(app).post(`${API}/cms/talukas`).set(auth(admin.token)).send({ districtId: belagavi.id, name: 'Igatpuri' });
    expect(other.status).toBe(201);
  });

  it('enforces code uniqueness within the district when a code is given', async () => {
    await makeTaluka(app, admin.token, nashik.id, 'Sinnar', 'SNR');
    const dup = await request(app).post(`${API}/cms/talukas`).set(auth(admin.token)).send({ districtId: nashik.id, name: 'Sinnar East', code: 'SNR' });
    expect(dup.status).toBe(409);
    const elsewhere = await request(app).post(`${API}/cms/talukas`).set(auth(admin.token)).send({ districtId: belagavi.id, name: 'Sinnar Like', code: 'SNR' });
    expect(elsewhere.status).toBe(201);
  });
});

/*
 * The rule the cascading dropdown exists for, checked on the server: the chosen district has to belong
 * to the chosen state. The browser filtering the second dropdown is a convenience, not the guarantee.
 */
describe('Taluka Master hierarchy verification', () => {
  it('refuses a district that does not belong to the submitted state', async () => {
    const res = await request(app)
      .post(`${API}/cms/talukas`)
      .set(auth(admin.token))
      .send({ stateId: mh.id, districtId: belagavi.id, name: 'Mismatched' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/does not belong to the selected state/i);
    expect(res.body.error.details?.[0]).toMatchObject({ field: 'districtId' });
  });

  it('accepts a matching state and district pair', async () => {
    const res = await request(app)
      .post(`${API}/cms/talukas`)
      .set(auth(admin.token))
      .send({ stateId: mh.id, districtId: pune.id, name: 'Khed' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ stateId: mh.id, districtId: pune.id });
  });

  it('refuses the same mismatch on update, and never writes stateId as a column', async () => {
    const taluka = await makeTaluka(app, admin.token, pune.id, 'Daund', 'DND');

    const mismatch = await request(app)
      .patch(`${API}/cms/talukas/${taluka.id}`)
      .set(auth(admin.token))
      .send({ stateId: ka.id, districtId: pune.id });
    expect(mismatch.status).toBe(400);

    /* A state-only payload is checked against the taluka current district. */
    const stateOnly = await request(app).patch(`${API}/cms/talukas/${taluka.id}`).set(auth(admin.token)).send({ stateId: ka.id });
    expect(stateOnly.status).toBe(400);

    /* Moving to a district in another state is allowed and updates the derived state. */
    const moved = await request(app)
      .patch(`${API}/cms/talukas/${taluka.id}`)
      .set(auth(admin.token))
      .send({ stateId: ka.id, districtId: belagavi.id });
    expect(moved.status).toBe(200);
    expect(moved.body.data).toMatchObject({ districtId: belagavi.id, stateId: ka.id, stateName: 'Karnataka', name: 'Daund' });
  });

  it('re-checks the name against the new district when a taluka moves', async () => {
    await makeTaluka(app, admin.token, belagavi.id, 'Shared Name');
    const moving = await makeTaluka(app, admin.token, pune.id, 'Shared Name');
    const res = await request(app).patch(`${API}/cms/talukas/${moving.id}`).set(auth(admin.token)).send({ districtId: belagavi.id });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already exists in the selected district/i);
  });
});

describe('Taluka Master listing', () => {
  it('shows the state and district names and filters by either parent', async () => {
    const byDistrict = await request(app).get(`${API}/cms/talukas`).query({ districtId: nashik.id, limit: 100 }).set(auth(admin.token));
    expect(byDistrict.status).toBe(200);
    expect(byDistrict.body.data.length).toBeGreaterThan(0);
    expect(byDistrict.body.data.every((t: { districtId: string }) => t.districtId === nashik.id)).toBe(true);
    expect(byDistrict.body.data[0]).toMatchObject({ districtName: 'Nashik', stateName: 'Maharashtra' });

    const byState = await request(app).get(`${API}/cms/talukas`).query({ stateId: ka.id, limit: 100 }).set(auth(admin.token));
    expect(byState.body.data.every((t: { stateId: string }) => t.stateId === ka.id)).toBe(true);

    expect((await request(app).get(`${API}/cms/talukas`).query({ stateId: MISSING_ID }).set(auth(admin.token))).status).toBe(400);
    expect((await request(app).get(`${API}/cms/talukas`).query({ districtId: MISSING_ID }).set(auth(admin.token))).status).toBe(400);
  });

  it('searches across the taluka, district and state names', async () => {
    const res = await request(app).get(`${API}/cms/talukas`).query({ search: 'Belagavi', limit: 100 }).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((t: { districtName: string }) => t.districtName === 'Belagavi')).toBe(true);
  });

  it('sorts by the district and state names', async () => {
    for (const sortBy of ['districtName', 'stateName']) {
      const res = await request(app).get(`${API}/cms/talukas`).query({ sortBy, sortOrder: 'asc', limit: 100 }).set(auth(admin.token));
      expect(res.status).toBe(200);
      const key = sortBy === 'districtName' ? 'districtName' : 'stateName';
      const values = res.body.data.map((t: Record<string, string>) => t[key]);
      expect([...values].sort((a: string, b: string) => a.localeCompare(b))).toEqual(values);
    }
  });
});

describe('Talukas of a district (dropdown feed)', () => {
  it('returns the active talukas of one district', async () => {
    const district = await makeDistrict(app, admin.token, mh.id, 'Feed District', 'FD');
    const live = await makeTaluka(app, admin.token, district.id, 'Live Taluka');
    const dormant = await makeTaluka(app, admin.token, district.id, 'Dormant Taluka');
    await request(app).patch(`${API}/cms/talukas/${dormant.id}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);

    const res = await request(app).get(`${API}/cms/districts/${district.id}/talukas`).set(auth(admin.token));
    expect(res.status).toBe(200);
    const ids = res.body.data.map((t: { id: string }) => t.id);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(dormant.id);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['code', 'districtId', 'id', 'name']);
  });

  it('404s for an unknown district', async () => {
    expect((await request(app).get(`${API}/cms/districts/${MISSING_ID}/talukas`).set(auth(admin.token))).status).toBe(404);
  });
});

describe('Taluka Master deletion and authorisation', () => {
  it('soft-deletes and frees the name for reuse in the same district', async () => {
    const taluka = await makeTaluka(app, admin.token, pune.id, 'Temporary Taluka', 'TMP');
    await request(app).delete(`${API}/cms/talukas/${taluka.id}`).set(auth(admin.token)).expect(200);
    expect((await request(app).get(`${API}/cms/talukas/${taluka.id}`).set(auth(admin.token))).status).toBe(404);

    const reused = await request(app).post(`${API}/cms/talukas`).set(auth(admin.token)).send({ districtId: pune.id, name: 'Temporary Taluka', code: 'TMP' });
    expect(reused.status).toBe(201);
  });

  it('needs a session, and write needs more than view', async () => {
    expect((await request(app).get(`${API}/cms/talukas`)).status).toBe(401);
    const viewer = await actorWith(VIEW_ONLY_CODES);
    expect((await request(app).get(`${API}/cms/talukas`).set(auth(viewer.token))).status).toBe(200);
    expect((await request(app).post(`${API}/cms/talukas`).set(auth(viewer.token)).send({ districtId: pune.id, name: 'Nope' })).status).toBe(403);
  });
});
