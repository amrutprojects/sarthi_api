import type { Express } from 'express';
import { API, actorWith, auth, request, setupTestApp, superAdmin, teardownTestApp, type TestActor } from '../helpers/test-app';
import { CMS_CODES, MISSING_ID, VIEW_ONLY_CODES, makeDistrict, makeState } from './helpers';

let app: Express;
let admin: TestActor;
let editor: TestActor;

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
  editor = await actorWith(CMS_CODES);
});
afterAll(teardownTestApp);

describe('State Master CRUD', () => {
  it('creates a state, then lists and gets it', async () => {
    const res = await request(app).post(`${API}/cms/states`).set(auth(admin.token)).send({ name: 'Maharashtra', code: 'MH' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Maharashtra', code: 'MH', isActive: true });
    expect(res.body.data.id).toMatch(/^[0-9a-f-]{36}$/);

    const detail = await request(app).get(`${API}/cms/states/${res.body.data.id}`).set(auth(admin.token));
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({ code: 'MH', districtCount: 0 });

    const list = await request(app).get(`${API}/cms/states`).query({ search: 'Mahar' }).set(auth(admin.token));
    expect(list.status).toBe(200);
    expect(list.body.data.map((s: { code: string }) => s.code)).toContain('MH');
    expect(list.body.meta).toMatchObject({ page: 1, total: expect.any(Number) });
  });

  it('trims the name, collapses inner spaces and upper-cases the code', async () => {
    const res = await request(app).post(`${API}/cms/states`).set(auth(admin.token)).send({ name: '  Tamil   Nadu ', code: ' tn ' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Tamil Nadu', code: 'TN' });
  });

  it('rejects a duplicate name case-insensitively, and a duplicate code (409)', async () => {
    await makeState(app, admin.token, 'Karnataka', 'KA');
    const dupName = await request(app).post(`${API}/cms/states`).set(auth(admin.token)).send({ name: 'karnataka', code: 'KA2' });
    expect(dupName.status).toBe(409);
    const dupCode = await request(app).post(`${API}/cms/states`).set(auth(admin.token)).send({ name: 'Karnataka North', code: 'KA' });
    expect(dupCode.status).toBe(409);
  });

  it('rejects an invalid name or code (422)', async () => {
    const cases = [
      { name: '', code: 'XX' },
      { name: 'A', code: 'XX' },
      { name: '<script>', code: 'XX' },
      { name: 'Valid Name', code: 'X' },
      { name: 'Valid Name', code: 'TOO-LONG-CODE' },
      { name: 'Valid Name', code: '1AB' },
    ];
    for (const body of cases) {
      const res = await request(app).post(`${API}/cms/states`).set(auth(admin.token)).send(body);
      expect([422, 400]).toContain(res.status);
    }
  });

  it('rejects unknown fields and an empty update body (422)', async () => {
    const state = await makeState(app, admin.token, 'Goa', 'GA');
    expect((await request(app).post(`${API}/cms/states`).set(auth(admin.token)).send({ name: 'X Y', code: 'XY', extra: 1 })).status).toBe(422);
    expect((await request(app).patch(`${API}/cms/states/${state.id}`).set(auth(admin.token)).send({})).status).toBe(422);
  });

  it('updates the name and code, through PATCH and through PUT', async () => {
    const state = await makeState(app, admin.token, 'Kerela', 'KL');
    const patched = await request(app).patch(`${API}/cms/states/${state.id}`).set(auth(admin.token)).send({ name: 'Kerala' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.name).toBe('Kerala');

    const put = await request(app).put(`${API}/cms/states/${state.id}`).set(auth(admin.token)).send({ code: 'KER' });
    expect(put.status).toBe(200);
    expect(put.body.data).toMatchObject({ name: 'Kerala', code: 'KER' });
  });

  it('activates and deactivates, and a 404 for an unknown id', async () => {
    const state = await makeState(app, admin.token, 'Punjab', 'PB');
    const off = await request(app).patch(`${API}/cms/states/${state.id}/status`).set(auth(admin.token)).send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.data.isActive).toBe(false);

    const on = await request(app).patch(`${API}/cms/states/${state.id}/status`).set(auth(admin.token)).send({ isActive: true });
    expect(on.body.data.isActive).toBe(true);

    expect((await request(app).get(`${API}/cms/states/${MISSING_ID}`).set(auth(admin.token))).status).toBe(404);
    expect((await request(app).get(`${API}/cms/states/not-a-uuid`).set(auth(admin.token))).status).toBe(422);
  });
});

describe('State Master deletion rules', () => {
  it('refuses to delete a state that still has districts, and allows it once they are gone', async () => {
    const state = await makeState(app, admin.token, 'Gujarat', 'GJ');
    const district = await makeDistrict(app, admin.token, state.id, 'Surat', 'SRT');

    const blocked = await request(app).delete(`${API}/cms/states/${state.id}`).set(auth(admin.token));
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/cannot be deleted/i);
    /* Still readable: nothing was changed by the refused delete. */
    expect((await request(app).get(`${API}/cms/states/${state.id}`).set(auth(admin.token))).status).toBe(200);

    await request(app).delete(`${API}/cms/districts/${district.id}`).set(auth(admin.token)).expect(200);
    expect((await request(app).delete(`${API}/cms/states/${state.id}`).set(auth(admin.token))).status).toBe(200);
    expect((await request(app).get(`${API}/cms/states/${state.id}`).set(auth(admin.token))).status).toBe(404);
  });

  it('frees the name and code for reuse after deletion, and can restore the record', async () => {
    const state = await makeState(app, admin.token, 'Assam', 'AS');
    await request(app).delete(`${API}/cms/states/${state.id}`).set(auth(admin.token)).expect(200);

    /* A soft-deleted row must not block a new record with the same name and code. */
    const reused = await request(app).post(`${API}/cms/states`).set(auth(admin.token)).send({ name: 'Assam', code: 'AS' });
    expect(reused.status).toBe(201);

    /* ...which in turn means the old row cannot be restored while the name is taken. */
    const restore = await request(app).post(`${API}/cms/states/${state.id}/restore`).set(auth(admin.token));
    expect(restore.status).toBe(409);

    await request(app).delete(`${API}/cms/states/${reused.body.data.id}`).set(auth(admin.token)).expect(200);
    const restored = await request(app).post(`${API}/cms/states/${state.id}/restore`).set(auth(admin.token));
    expect(restored.status).toBe(200);
    /* A restored record comes back inactive: re-activation is a separate, deliberate step. */
    expect(restored.body.data.isActive).toBe(false);
  });
});

describe('State Master listing', () => {
  it('paginates, sorts and filters by status', async () => {
    const list = await request(app).get(`${API}/cms/states`).query({ page: 1, limit: 2, sortBy: 'name', sortOrder: 'asc' }).set(auth(admin.token));
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeLessThanOrEqual(2);
    const names = list.body.data.map((s: { name: string }) => s.name);
    expect([...names].sort((a: string, b: string) => a.localeCompare(b))).toEqual(names);

    const state = await makeState(app, admin.token, 'Odisha', 'OD');
    await request(app).patch(`${API}/cms/states/${state.id}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);

    const inactive = await request(app).get(`${API}/cms/states`).query({ isActive: 'false', limit: 100 }).set(auth(admin.token));
    expect(inactive.body.data.every((s: { isActive: boolean }) => !s.isActive)).toBe(true);
    expect(inactive.body.data.map((s: { code: string }) => s.code)).toContain('OD');

    const active = await request(app).get(`${API}/cms/states`).query({ isActive: 'true', limit: 100 }).set(auth(admin.token));
    expect(active.body.data.map((s: { code: string }) => s.code)).not.toContain('OD');
  });

  it('rejects an unknown sort field and an out-of-range limit (422)', async () => {
    expect((await request(app).get(`${API}/cms/states`).query({ sortBy: 'passwordHash' }).set(auth(admin.token))).status).toBe(422);
    expect((await request(app).get(`${API}/cms/states`).query({ limit: 5000 }).set(auth(admin.token))).status).toBe(422);
  });
});

describe('State Master authorisation', () => {
  it('needs a session', async () => {
    expect((await request(app).get(`${API}/cms/states`)).status).toBe(401);
    expect((await request(app).post(`${API}/cms/states`).send({ name: 'No Auth', code: 'NA' })).status).toBe(401);
  });

  it('a view-only actor can read but not write (403)', async () => {
    const viewer = await actorWith(VIEW_ONLY_CODES);
    expect((await request(app).get(`${API}/cms/states`).set(auth(viewer.token))).status).toBe(200);
    expect((await request(app).post(`${API}/cms/states`).set(auth(viewer.token)).send({ name: 'Nope', code: 'NP' })).status).toBe(403);

    const state = await makeState(app, admin.token, 'Bihar', 'BR');
    expect((await request(app).patch(`${API}/cms/states/${state.id}`).set(auth(viewer.token)).send({ name: 'Bihar East' })).status).toBe(403);
    expect((await request(app).delete(`${API}/cms/states/${state.id}`).set(auth(viewer.token))).status).toBe(403);
  });

  it('an actor with no CMS permission at all cannot even read (403)', async () => {
    const outsider = await actorWith(['users.view']);
    expect((await request(app).get(`${API}/cms/states`).set(auth(outsider.token))).status).toBe(403);
  });

  it('an actor holding every CMS code can write', async () => {
    const res = await request(app).post(`${API}/cms/states`).set(auth(editor.token)).send({ name: 'Telangana', code: 'TS' });
    expect(res.status).toBe(201);
  });
});
