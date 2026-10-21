import type { Express } from 'express';
import { ALL_PERMISSIONS } from '../../../src/modules/roles-permissions/permission.constants';
import { Permission, Role } from '../../../src/database/entities';
import { seedRbac } from '../../../src/database/seeds/seed-rbac';
import {
  API,
  AppDataSource,
  auth,
  createRoleWith,
  createUser,
  login,
  permissionId,
  request,
  setupTestApp,
  superAdmin,
  teardownTestApp,
  type TestActor,
} from '../../helpers/test-app';

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
    const created = await request(app)
      .post(`${API}/permissions`)
      .set(auth(admin.token))
      .send({ name: 'Export candidates', code: 'candidates.export' });
    expect(created.status).toBe(201);
    expect(created.body.data.module).toBe('candidates');
    const id = created.body.data.id;
    expect(
      (await request(app).patch(`${API}/permissions/${id}`).set(auth(admin.token)).send({ name: 'Export candidate list' })).body.data.name,
    ).toBe('Export candidate list');
    expect(
      (await request(app).patch(`${API}/permissions/${id}/status`).set(auth(admin.token)).send({ isActive: false })).body.data.isActive,
    ).toBe(false);
    expect((await request(app).delete(`${API}/permissions/${id}`).set(auth(admin.token))).status).toBe(200);
    expect((await request(app).get(`${API}/permissions/${id}`).set(auth(admin.token))).status).toBe(404);
    expect((await request(app).post(`${API}/permissions/${id}/restore`).set(auth(admin.token))).body.data.isActive).toBe(false);
  });

  it('validates codes and rejects duplicates', async () => {
    expect((await request(app).post(`${API}/permissions`).set(auth(admin.token)).send({ name: 'x', code: 'NoDots' })).status).toBe(422);
    expect((await request(app).post(`${API}/permissions`).set(auth(admin.token)).send({ name: 'x', code: 'users.view' })).status).toBe(409);
    expect(
      (await request(app).post(`${API}/permissions`).set(auth(admin.token)).send({ name: 'x', code: 'a.b', module: 'c' })).status,
    ).toBe(422);
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
    expect(
      (
        await request(app)
          .put(`${API}/roles/${role.id}/permissions`)
          .set(auth(admin.token))
          .send({ permissionIds: [id] })
      ).status,
    ).toBe(400);
    await request(app).delete(`${API}/permissions/${id}`).set(auth(admin.token)).expect(200);
    expect(
      (
        await request(app)
          .put(`${API}/roles/${role.id}/permissions`)
          .set(auth(admin.token))
          .send({ permissionIds: [id] })
      ).status,
    ).toBe(400);
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

describe('seed carry-over of a kept code to its new counterpart (LEGACY_CODE_MAP)', () => {
  /* An upgraded database: the new code has never existed (no row at all, not even a soft-deleted one). */
  const forgetCode = async (code: string) => {
    await AppDataSource.query(
      `DELETE FROM "role_permissions" WHERE "permissionId" IN (SELECT "id" FROM "permissions" WHERE "code" = $1)`,
      [code],
    );
    await AppDataSource.query(`DELETE FROM "permissions" WHERE "code" = $1`, [code]);
  };
  const activeNew = async (code: string) =>
    AppDataSource.getRepository(Permission).findOneByOrFail({ code, isDelete: false });
  const roleHolds = async (roleId: string, permissionId: string) =>
    Number(
      (
        await AppDataSource.query(
          `SELECT count(*)::int AS n FROM "role_permissions" WHERE "roleId" = $1 AND "permissionId" = $2 AND "isDelete" = false`,
          [roleId, permissionId],
        )
      )[0].n,
    );

  it('copies an active old code to the first-time new code', async () => {
    const role = await createRoleWith(['lms-calendars.view']);
    await forgetCode('lms-learning-config.view');
    await seedRbac(AppDataSource);
    const created = await activeNew('lms-learning-config.view');
    expect(created.isActive).toBe(true);
    expect(await roleHolds(role.id, created.id)).toBe(1);
  });

  it('carries an admin deactivation over: the new code of a deactivated old code starts inactive', async () => {
    const role = await createRoleWith(['lms-branding.update']);
    const oldId = await permissionId('lms-branding.update');
    await request(app).patch(`${API}/permissions/${oldId}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);
    await forgetCode('lms-branding.update-settings');
    await seedRbac(AppDataSource);
    const created = await activeNew('lms-branding.update-settings');
    /* The grant follows, but grants nothing until an admin activates the code. */
    expect(created.isActive).toBe(false);
    expect(await roleHolds(role.id, created.id)).toBe(1);
    await request(app).patch(`${API}/permissions/${oldId}/status`).set(auth(admin.token)).send({ isActive: true }).expect(200);
    await AppDataSource.getRepository(Permission).update(created.id, { isActive: true });
  });

  it('does not re-grant a new code an admin deleted: it is re-created for the catalogue only', async () => {
    const role = await createRoleWith(['lms-calendars.update']);
    const deletedId = await permissionId('lms-learning-config.update');
    await request(app).delete(`${API}/permissions/${deletedId}`).set(auth(admin.token)).expect(200);
    const run = await seedRbac(AppDataSource);
    expect(run.permissionsCreated).toBe(1);
    const recreated = await activeNew('lms-learning-config.update');
    expect(recreated.id).not.toBe(deletedId);
    expect(await roleHolds(role.id, recreated.id)).toBe(0);
    /* SUPER_ADMIN still holds every catalogue permission (documented re-sync). */
    const superAdminRole = await AppDataSource.getRepository(Role).findOneByOrFail({ code: 'SUPER_ADMIN', isDelete: false });
    expect(await roleHolds(superAdminRole.id, recreated.id)).toBe(1);
  });
});
