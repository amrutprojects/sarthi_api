import type { Express } from 'express';
import { API, auth, request, setupTestApp, superAdmin, teardownTestApp, type TestActor } from '../helpers/test-app';
import { MISSING_ID, makeDistrict, makeState, makeTaluka } from './helpers';

const PUBLIC = `${API}/public/geography`;

let app: Express;
let admin: TestActor;
let live: { id: string };
let dormant: { id: string };
let district: { id: string };

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();

  live = await makeState(app, admin.token, 'Maharashtra', 'MH');
  district = await makeDistrict(app, admin.token, live.id, 'Pune', 'PUN');
  await makeTaluka(app, admin.token, district.id, 'Haveli', 'HVL');

  dormant = await makeState(app, admin.token, 'Dormant State', 'DRM');
  await request(app).patch(`${API}/cms/states/${dormant.id}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);
});
afterAll(teardownTestApp);

/*
 * The read-only feed the public website consumes. It is unauthenticated on purpose, so these tests are
 * as much about what it refuses to expose as about what it returns.
 */
describe('public geography feed', () => {
  it('serves the cascade without a session', async () => {
    const states = await request(app).get(`${PUBLIC}/states`);
    expect(states.status).toBe(200);
    expect(states.body.success).toBe(true);

    const districts = await request(app).get(`${PUBLIC}/states/${live.id}/districts`);
    expect(districts.status).toBe(200);
    expect(districts.body.data.map((d: { code: string }) => d.code)).toContain('PUN');

    const talukas = await request(app).get(`${PUBLIC}/districts/${district.id}/talukas`);
    expect(talukas.status).toBe(200);
    expect(talukas.body.data.map((t: { code: string }) => t.code)).toContain('HVL');
  });

  it('returns only active records', async () => {
    const states = await request(app).get(`${PUBLIC}/states`);
    const codes = states.body.data.map((s: { code: string }) => s.code);
    expect(codes).toContain('MH');
    expect(codes).not.toContain('DRM');

    const off = await makeDistrict(app, admin.token, live.id, 'Hidden District', 'HID');
    await request(app).patch(`${API}/cms/districts/${off.id}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);
    const districts = await request(app).get(`${PUBLIC}/states/${live.id}/districts`);
    expect(districts.body.data.map((d: { code: string }) => d.code)).not.toContain('HID');
  });

  it('exposes only id, name and code — never the administrative columns', async () => {
    const states = await request(app).get(`${PUBLIC}/states`);
    expect(Object.keys(states.body.data[0]).sort()).toEqual(['code', 'id', 'name']);

    const serialised = JSON.stringify(states.body);
    for (const leaked of ['isActive', 'isDelete', 'createdAt', 'updatedAt', 'districtCount']) {
      expect(serialised).not.toContain(leaked);
    }
  });

  it('reflects a CMS change immediately', async () => {
    const before = await request(app).get(`${PUBLIC}/states`);
    expect(before.body.data.map((s: { code: string }) => s.code)).not.toContain('NEWST');

    await makeState(app, admin.token, 'Newly Added', 'NEWST');
    const after = await request(app).get(`${PUBLIC}/states`);
    expect(after.body.data.map((s: { code: string }) => s.code)).toContain('NEWST');
  });

  it('404s for an unknown parent and 422s for a malformed id', async () => {
    expect((await request(app).get(`${PUBLIC}/states/${MISSING_ID}/districts`)).status).toBe(404);
    expect((await request(app).get(`${PUBLIC}/districts/${MISSING_ID}/talukas`)).status).toBe(404);
    expect((await request(app).get(`${PUBLIC}/states/not-a-uuid/districts`)).status).toBe(422);
  });

  it('offers no write path', async () => {
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await request(app)[method](`${PUBLIC}/states`).send({ name: 'Injected', code: 'INJ' });
      expect(res.status).toBe(404);
    }
    /* And the administrative routes are still closed. */
    expect((await request(app).post(`${API}/cms/states`).send({ name: 'Injected', code: 'INJ' })).status).toBe(401);
  });
});
