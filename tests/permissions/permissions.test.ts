import type { Express } from 'express';
import { ALL_PERMISSIONS } from '../../src/constants/permission.constants';
import { Permission, Role } from '../../src/entities';
import { seedRbac } from '../../seeds/seed-rbac';
import {
  API, AppDataSource, auth, createRoleWith, createUser, login, permissionId, request, setupTestApp, superAdmin, teardownTestApp,
  type TestActor,
} from '../helpers/test-app';

let app: Express;
let admin: TestActor;
beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
});
afterAll(teardownTestApp);

describe('permission CRUD', () => {
  it('lists the seeded catalogue with module filter and pagination', async () => {
    const res = await request(app).get(`${API}/permissions`).query({ module: 'users', limit: 100 }).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data.every((p: { module: string }) => p.module === 'users')).toBe(true);
    expect(res.body.data.map((p: { code: string }) => p.code)).toEqual(expect.arrayContaining(['users.view', 'users.create']));
    const modules = await request(app).get(`${API}/permissions/modules`).set(auth(admin.token));
    expect(modules.body.data).toEqual(expect.arrayContaining(['users', 'roles', 'permissions', 'candidates', 'finance']));
  });

  it('creates, updates, deactivates, deletes and restores a permission', async () => {
    const created = await request(app).post(`${API}/permissions`).set(auth(admin.token)).send({ name: 'Export candidates', code: 'candidates.export' });
    expect(created.status).toBe(201);
    expect(created.body.data.module).toBe('candidates');
    const id = created.body.data.id;
    expect((await request(app).patch(`${API}/permissions/${id}`).set(auth(admin.token)).send({ name: 'Export candidate list' })).body.data.name).toBe('Export candidate list');
    expect((await request(app).patch(`${API}/permissions/${id}/status`).set(auth(admin.token)).send({ isActive: false })).body.data.isActive).toBe(false);
    expect((await request(app).delete(`${API}/permissions/${id}`).set(auth(admin.token))).status).toBe(200);
    expect((await request(app).get(`${API}/permissions/${id}`).set(auth(admin.token))).status).toBe(404);
    expect((await request(app).post(`${API}/permissions/${id}/restore`).set(auth(admin.token))).body.data.isActive).toBe(false);
  });

  it('validates codes and rejects duplicates', async () => {
    expect((await request(app).post(`${API}/permissions`).set(auth(admin.token)).send({ name: 'x', code: 'NoDots' })).status).toBe(422);
    expect((await request(app).post(`${API}/permissions`).set(auth(admin.token)).send({ name: 'x', code: 'users.view' })).status).toBe(409);
    expect((await request(app).post(`${API}/permissions`).set(auth(admin.token)).send({ name: 'x', code: 'a.b', module: 'c' })).status).toBe(422);
  });
});

describe('inactive / deleted permissions never grant access', () => {
  it('deactivating a permission revokes it from every role immediately', async () => {
    const role = await createRoleWith(['users.view']);
    const user = await createUser({ roleCodes: [role.code] });
    const token = await login(user.email);
    const pid = await permissionId('users.view');
    expect((await request(app).get(`${API}/users`).set(auth(token))).status).toBe(200);
    await request(app).patch(`${API}/permissions/${pid}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);
    expect((await request(app).get(`${API}/users`).set(auth(token))).status).toBe(403);
    await request(app).patch(`${API}/permissions/${pid}/status`).set(auth(admin.token)).send({ isActive: true }).expect(200);
  });

  it('cannot assign a deleted or inactive permission to a role', async () => {
    const created = await request(app).post(`${API}/permissions`).set(auth(admin.token)).send({ name: 'Temp', code: 'temp.thing' });
    const id = created.body.data.id;
    const role = await createRoleWith([]);
    await request(app).patch(`${API}/permissions/${id}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);
    expect((await request(app).put(`${API}/roles/${role.id}/permissions`).set(auth(admin.token)).send({ permissionIds: [id] })).status).toBe(400);
    await request(app).delete(`${API}/permissions/${id}`).set(auth(admin.token)).expect(200);
    expect((await request(app).put(`${API}/roles/${role.id}/permissions`).set(auth(admin.token)).send({ permissionIds: [id] })).status).toBe(400);
  });
});

describe('seed script', () => {
  it('is idempotent: re-running creates no duplicates', async () => {
    const second = await seedRbac(AppDataSource);
    expect(second.permissionsCreated).toBe(0);
    expect(second.rolesCreated).toBe(0);
    expect(await AppDataSource.getRepository(Permission).countBy({ isDelete: false, code: 'users.view' })).toBe(1);
    expect(await AppDataSource.getRepository(Role).countBy({ isDelete: false, code: 'SUPER_ADMIN' })).toBe(1);
  });

  it('gives SUPER_ADMIN every catalogue permission', async () => {
    const res = await request(app).get(`${API}/auth/permissions`).set(auth(admin.token));
    expect(res.body.data.permissions).toEqual(expect.arrayContaining(ALL_PERMISSIONS.map((p) => p.code)));
  });
});
