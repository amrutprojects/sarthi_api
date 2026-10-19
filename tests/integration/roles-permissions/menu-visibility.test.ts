import type { Express } from 'express';
import { API, auth, createUser, login, request, resetData, setupTestApp, teardownTestApp } from '../../helpers/test-app';

let app: Express;
beforeAll(async () => { app = await setupTestApp(); });
beforeEach(resetData);
afterAll(teardownTestApp);

describe('menu visibility', () => {
  it('hides a menu for a role, reports it in /auth/me, and can show it again', async () => {
    const admin = await createUser({ roleCodes: ['SUPER_ADMIN'] });
    const helpdesk = await createUser({ roleCodes: ['HELPDESK'] });
    const at = auth(await login(admin.email));

    const matrix = await request(app).get(`${API}/menu-visibility`).set(at);
    expect(matrix.status).toBe(200);
    const role = matrix.body.data.roles.find((r: { code: string }) => r.code === 'HELPDESK');
    expect(matrix.body.data.menus).toContain('comms');

    const hide = await request(app).put(`${API}/menu-visibility`).set(at).send({ changes: [{ roleId: role.id, menuKey: 'comms', visible: false }] });
    expect(hide.status).toBe(200);
    let me = await request(app).get(`${API}/auth/me`).set(auth(await login(helpdesk.email)));
    expect(me.body.data.hiddenMenus).toEqual(['comms']);
    expect(me.body.data.permissions).toContain('comms.view');

    await request(app).put(`${API}/menu-visibility`).set(at).send({ changes: [{ roleId: role.id, menuKey: 'comms', visible: true }] });
    me = await request(app).get(`${API}/auth/me`).set(auth(await login(helpdesk.email)));
    expect(me.body.data.hiddenMenus).toEqual([]);
  });

  it('refuses unknown menus, hiding Users & Roles from Super Admin, and callers without roles.update', async () => {
    const admin = await createUser({ roleCodes: ['SUPER_ADMIN'] });
    const at = auth(await login(admin.email));
    const roles = (await request(app).get(`${API}/menu-visibility`).set(at)).body.data.roles as { id: string; code: string }[];
    const sa = roles.find((r) => r.code === 'SUPER_ADMIN')!;

    expect((await request(app).put(`${API}/menu-visibility`).set(at).send({ changes: [{ roleId: sa.id, menuKey: 'nope', visible: false }] })).status).toBe(400);
    expect((await request(app).put(`${API}/menu-visibility`).set(at).send({ changes: [{ roleId: sa.id, menuKey: 'users', visible: false }] })).status).toBe(403);

    const viewer = await createUser({ roleCodes: ['VIEWER'] });
    const res = await request(app).put(`${API}/menu-visibility`).set(auth(await login(viewer.email))).send({ changes: [{ roleId: sa.id, menuKey: 'finance', visible: false }] });
    expect(res.status).toBe(403);
  });
});
