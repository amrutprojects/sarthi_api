import type { Express } from 'express';
import { Role, RolePermission } from '../../../src/database/entities';
import {
  API, AppDataSource, auth, createRoleWith, createUser, login, permissionId, request, roleId, setupTestApp, superAdmin, teardownTestApp,
  type TestActor,
} from '../../helpers/test-app';

let app: Express;
let admin: TestActor;
beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
});
afterAll(teardownTestApp);

describe('role CRUD', () => {
  it('creates a role with permissions, and lists / gets it', async () => {
    const res = await request(app).post(`${API}/roles`).set(auth(admin.token)).send({
      name: 'Regional Lead', code: 'REGIONAL_LEAD', description: 'Region oversight',
      permissionIds: [await permissionId('dashboard.view'), await permissionId('districts.view')],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.permissions.map((p: { code: string }) => p.code).sort()).toEqual(['dashboard.view', 'districts.view']);

    const list = await request(app).get(`${API}/roles`).query({ search: 'REGIONAL' }).set(auth(admin.token));
    expect(list.body.data.map((r: { code: string }) => r.code)).toContain('REGIONAL_LEAD');
    expect(list.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('rejects duplicate codes (409) and invalid codes (422)', async () => {
    await request(app).post(`${API}/roles`).set(auth(admin.token)).send({ name: 'Dup', code: 'DUP_ROLE' }).expect(201);
    expect((await request(app).post(`${API}/roles`).set(auth(admin.token)).send({ name: 'Dup 2', code: 'DUP_ROLE' })).status).toBe(409);
    expect((await request(app).post(`${API}/roles`).set(auth(admin.token)).send({ name: 'Bad', code: 'bad code' })).status).toBe(422);
  });

  it('updates name / description but not the code', async () => {
    const role = await createRoleWith([]);
    const res = await request(app).patch(`${API}/roles/${role.id}`).set(auth(admin.token)).send({ name: 'Better name' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Better name');
    expect((await request(app).patch(`${API}/roles/${role.id}`).set(auth(admin.token)).send({ code: 'NEW_CODE' })).status).toBe(422);
  });

  it('soft-deletes a role and it stops granting access immediately', async () => {
    const role = await createRoleWith(['users.view']);
    const user = await createUser({ roleCodes: [role.code] });
    const token = await login(user.email);
    expect((await request(app).get(`${API}/users`).set(auth(token))).status).toBe(200);

    expect((await request(app).delete(`${API}/roles/${role.id}`).set(auth(admin.token))).status).toBe(200);
    expect((await request(app).get(`${API}/roles/${role.id}`).set(auth(admin.token))).status).toBe(404);
    expect((await AppDataSource.getRepository(Role).findOneByOrFail({ id: role.id }))).toMatchObject({ isDelete: true, isActive: false });
    expect((await request(app).get(`${API}/users`).set(auth(token))).status).toBe(403);
  });

  it('a deactivated role grants nothing; reactivating restores access', async () => {
    const role = await createRoleWith(['users.view']);
    const user = await createUser({ roleCodes: [role.code] });
    const token = await login(user.email);
    await request(app).patch(`${API}/roles/${role.id}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);
    expect((await request(app).get(`${API}/users`).set(auth(token))).status).toBe(403);
    await request(app).patch(`${API}/roles/${role.id}/status`).set(auth(admin.token)).send({ isActive: true }).expect(200);
    expect((await request(app).get(`${API}/users`).set(auth(token))).status).toBe(200);
  });

  it('cannot assign a deleted or inactive role', async () => {
    const inactive = await createRoleWith([]);
    await request(app).patch(`${API}/roles/${inactive.id}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);
    const deleted = await createRoleWith([]);
    await request(app).delete(`${API}/roles/${deleted.id}`).set(auth(admin.token)).expect(200);
    const u = await createUser();
    for (const id of [inactive.id, deleted.id]) {
      expect((await request(app).put(`${API}/users/${u.id}/roles`).set(auth(admin.token)).send({ roleIds: [id] })).status).toBe(400);
    }
  });

  it('restores a deleted role as inactive', async () => {
    const role = await createRoleWith([]);
    await request(app).delete(`${API}/roles/${role.id}`).set(auth(admin.token)).expect(200);
    const res = await request(app).post(`${API}/roles/${role.id}/restore`).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
  });
});

describe('protected SUPER_ADMIN role', () => {
  it('cannot be deleted, deactivated or have its permissions replaced', async () => {
    const id = await roleId('SUPER_ADMIN');
    expect((await request(app).delete(`${API}/roles/${id}`).set(auth(admin.token))).status).toBe(403);
    expect((await request(app).patch(`${API}/roles/${id}/status`).set(auth(admin.token)).send({ isActive: false })).status).toBe(403);
    expect((await request(app).put(`${API}/roles/${id}/permissions`).set(auth(admin.token)).send({ permissionIds: [] })).status).toBe(403);
  });
});

describe('role-permission assignment', () => {
  it('replaces grants atomically, soft-deleting removed ones', async () => {
    const role = await createRoleWith(['dashboard.view', 'reports.view']);
    const res = await request(app).put(`${API}/roles/${role.id}/permissions`).set(auth(admin.token))
      .send({ permissionIds: [await permissionId('reports.view'), await permissionId('finance.view')] });
    expect(res.status).toBe(200);
    expect(res.body.data.map((p: { code: string }) => p.code).sort()).toEqual(['finance.view', 'reports.view']);
    const all = await AppDataSource.getRepository(RolePermission).find({ where: { roleId: role.id }, relations: { permission: true } });
    const dash = all.find((g) => g.permission.code === 'dashboard.view');
    expect(dash).toMatchObject({ isDelete: true, isActive: false });
  });

  it('ignores duplicates in the request and never creates duplicate active grants', async () => {
    const role = await createRoleWith([]);
    const pid = await permissionId('dashboard.view');
    await request(app).put(`${API}/roles/${role.id}/permissions`).set(auth(admin.token)).send({ permissionIds: [pid, pid] }).expect(200);
    await request(app).put(`${API}/roles/${role.id}/permissions`).set(auth(admin.token)).send({ permissionIds: [pid] }).expect(200);
    expect(await AppDataSource.getRepository(RolePermission).countBy({ roleId: role.id, permissionId: pid, isDelete: false })).toBe(1);
  });

  it('the database rejects a second active grant (partial unique index)', async () => {
    const role = await createRoleWith(['dashboard.view']);
    const pid = await permissionId('dashboard.view');
    await expect(AppDataSource.getRepository(RolePermission).insert({ roleId: role.id, permissionId: pid })).rejects.toThrow(/UQ_role_permissions_active/);
  });

  it('cannot change permissions of an inactive role', async () => {
    const role = await createRoleWith([]);
    await request(app).patch(`${API}/roles/${role.id}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);
    expect((await request(app).put(`${API}/roles/${role.id}/permissions`).set(auth(admin.token)).send({ permissionIds: [] })).status).toBe(400);
  });
});
