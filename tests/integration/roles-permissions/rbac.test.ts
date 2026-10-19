import type { Express } from 'express';
import { AuditLog, UserRole } from '../../../src/database/entities';
import {
  API, AppDataSource, actorWith, auth, createRoleWith, createUser, login, permissionId, request, roleId, setupTestApp, superAdmin,
  teardownTestApp, type TestActor,
} from '../../helpers/test-app';

let app: Express;
let admin: TestActor;
beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
});
afterAll(teardownTestApp);

const PROTECTED: [string, string][] = [
  ['get', '/users'], ['post', '/users'], ['get', '/users/00000000-0000-4000-8000-000000000000'],
  ['patch', '/users/00000000-0000-4000-8000-000000000000'], ['delete', '/users/00000000-0000-4000-8000-000000000000'],
  ['put', '/users/00000000-0000-4000-8000-000000000000/roles'],
  ['get', '/roles'], ['post', '/roles'], ['put', '/roles/00000000-0000-4000-8000-000000000000/permissions'],
  ['get', '/permissions'], ['post', '/permissions'], ['delete', '/permissions/00000000-0000-4000-8000-000000000000'],
  ['get', '/audit-logs'],
];

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
const call = (method: string, path: string) => request(app)[method as Method](`${API}${path}`);

describe('authentication vs authorization', () => {
  it('401 on every protected endpoint without a token', async () => {
    for (const [m, p] of PROTECTED) {
      const res = await call(m, p);
      expect([m, p, res.status]).toEqual([m, p, 401]);
    }
  });

  it('403 on every protected endpoint for a user with no permissions (deny by default)', async () => {
    const nobody = await createUser();
    const token = await login(nobody.email);
    for (const [m, p] of PROTECTED) {
      const res = await call(m, p).set(auth(token)).send({});
      expect([m, p, res.status]).toEqual([m, p, 403]);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('one permission opens exactly its endpoint', async () => {
    const viewer = await actorWith(['users.view']);
    expect((await request(app).get(`${API}/users`).set(auth(viewer.token))).status).toBe(200);
    expect((await request(app).post(`${API}/users`).set(auth(viewer.token)).send({})).status).toBe(403);
    expect((await request(app).get(`${API}/roles`).set(auth(viewer.token))).status).toBe(403);
  });

  it('checks permission before validating the body (no information leak)', async () => {
    const viewer = await actorWith(['users.view']);
    const res = await request(app).post(`${API}/users`).set(auth(viewer.token)).send({ junk: true });
    expect(res.status).toBe(403);
  });

  it('records denied attempts in the audit log', async () => {
    const viewer = await actorWith(['users.view']);
    await request(app).delete(`${API}/users/${viewer.user.id}`).set(auth(viewer.token));
    const denied = await AppDataSource.getRepository(AuditLog).findOneBy({ actorUserId: viewer.user.id, action: 'authz.denied' });
    expect(denied?.outcome).toBe('DENIED');
    expect(denied?.details).toMatchObject({ required: ['users.delete'] });
  });
});

describe('privilege escalation prevention', () => {
  it('an assigner cannot grant a role carrying permissions they do not hold', async () => {
    const assigner = await actorWith(['users.assign-roles', 'users.view']);
    const target = await createUser();
    const res = await request(app).put(`${API}/users/${target.id}/roles`).set(auth(assigner.token)).send({ roleIds: [await roleId('SUPER_ADMIN')] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PRIVILEGE_ESCALATION');
    expect(await AppDataSource.getRepository(UserRole).countBy({ userId: target.id, isDelete: false })).toBe(0);
  });

  it('an assigner can grant a role whose permissions they hold', async () => {
    const assigner = await actorWith(['users.assign-roles', 'users.view', 'dashboard.view']);
    const small = await createRoleWith(['dashboard.view']);
    const target = await createUser();
    const res = await request(app).put(`${API}/users/${target.id}/roles`).set(auth(assigner.token)).send({ roleIds: [small.id] });
    expect(res.status).toBe(200);
    expect(res.body.data.map((r: { code: string }) => r.code)).toEqual([small.code]);
  });

  it('nobody can change their own roles, not even a Super Admin', async () => {
    const res = await request(app).put(`${API}/users/${admin.user.id}/roles`).set(auth(admin.token)).send({ roleIds: [] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SELF_PRIVILEGE_CHANGE');
  });

  it('cannot grant a permission to a role unless the actor holds it', async () => {
    const granter = await actorWith(['permissions.assign', 'roles.view', 'dashboard.view']);
    const target = await createRoleWith([]);
    const bad = await request(app).put(`${API}/roles/${target.id}/permissions`).set(auth(granter.token)).send({ permissionIds: [await permissionId('users.delete')] });
    expect(bad.status).toBe(403);
    expect(bad.body.error.code).toBe('PRIVILEGE_ESCALATION');
    const ok = await request(app).put(`${API}/roles/${target.id}/permissions`).set(auth(granter.token)).send({ permissionIds: [await permissionId('dashboard.view')] });
    expect(ok.status).toBe(200);
  });

  it('cannot add permissions to their own role (self privilege change)', async () => {
    const granter = await actorWith(['permissions.assign', 'roles.view', 'dashboard.view']);
    const res = await request(app).put(`${API}/roles/${granter.role!.id}/permissions`).set(auth(granter.token)).send({ permissionIds: [await permissionId('dashboard.view')] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SELF_PRIVILEGE_CHANGE');
  });

  it('cannot create a role pre-loaded with permissions the actor lacks', async () => {
    const creator = await actorWith(['roles.create', 'permissions.assign']);
    const res = await request(app).post(`${API}/roles`).set(auth(creator.token)).send({ name: 'Sneaky', code: 'SNEAKY', permissionIds: [await permissionId('finance.approve')] });
    expect(res.status).toBe(403);
  });

  it('cannot create a user with roles without users.assign-roles', async () => {
    const creator = await actorWith(['users.create']);
    const res = await request(app).post(`${API}/users`).set(auth(creator.token)).send({
      name: 'X', email: `x.${Date.now()}@test.local`, password: 'Strong-Pass-123', roleIds: [await roleId('VIEWER')],
    });
    expect(res.status).toBe(403);
  });
});

describe('last Super Admin protection', () => {
  it('blocks removing the role from the only remaining active Super Admin', async () => {
    // Deactivate every Super Admin except `admin` and one target, then make the target the last one.
    const target = await createUser({ roleCodes: ['SUPER_ADMIN'] });
    const superAdminRoleId = await roleId('SUPER_ADMIN');
    await AppDataSource.query(
      `UPDATE "user_roles" SET "isDelete" = true, "isActive" = false WHERE "roleId" = $1 AND "userId" NOT IN ($2, $3)`,
      [superAdminRoleId, admin.user.id, target.id],
    );
    // admin removes target's Super Admin: allowed (admin remains).
    expect((await request(app).put(`${API}/users/${target.id}/roles`).set(auth(admin.token)).send({ roleIds: [] })).status).toBe(200);

    // Now only `admin` is a Super Admin. Another privileged user tries to strip, deactivate or delete admin.
    const manager = await createUser({ roleCodes: ['SUPER_ADMIN'] });
    const managerToken = await login(manager.email);
    await AppDataSource.query(`UPDATE "user_roles" SET "isDelete" = true, "isActive" = false WHERE "roleId" = $1 AND "userId" = $2`, [superAdminRoleId, manager.id]);
    const powerRole = await createRoleWith(['users.update', 'users.delete', 'users.assign-roles', 'users.view']);
    await AppDataSource.getRepository(UserRole).insert({ userId: manager.id, roleId: powerRole.id });
    const { rbacService } = await import('../../../src/modules/roles-permissions/rbac.service');
    rbacService.invalidate();

    expect((await request(app).patch(`${API}/users/${admin.user.id}/status`).set(auth(managerToken)).send({ isActive: false })).status).toBe(409);
    expect((await request(app).delete(`${API}/users/${admin.user.id}`).set(auth(managerToken))).status).toBe(409);
  });
});

describe('permission changes take effect immediately (cache invalidation)', () => {
  it('removing a grant revokes access on the next request', async () => {
    const role = await createRoleWith(['users.view', 'roles.view']);
    const user = await createUser({ roleCodes: [role.code] });
    const token = await login(user.email);
    expect((await request(app).get(`${API}/users`).set(auth(token))).status).toBe(200);
    await request(app).put(`${API}/roles/${role.id}/permissions`).set(auth(admin.token)).send({ permissionIds: [await permissionId('roles.view')] }).expect(200);
    expect((await request(app).get(`${API}/users`).set(auth(token))).status).toBe(403);
    expect((await request(app).get(`${API}/roles`).set(auth(token))).status).toBe(200);
  });

  it('removing a user role assignment revokes access on the next request', async () => {
    const role = await createRoleWith(['users.view']);
    const user = await createUser({ roleCodes: [role.code] });
    const token = await login(user.email);
    await request(app).put(`${API}/users/${user.id}/roles`).set(auth(admin.token)).send({ roleIds: [] }).expect(200);
    expect((await request(app).get(`${API}/users`).set(auth(token))).status).toBe(403);
  });
});

describe('audit trail for privilege changes', () => {
  it('records role and permission assignment changes with actor and request id', async () => {
    const role = await createRoleWith([]);
    const target = await createUser();
    const r1 = await request(app).put(`${API}/roles/${role.id}/permissions`).set(auth(admin.token)).set('X-Request-Id', 'req-perm-1')
      .send({ permissionIds: [await permissionId('dashboard.view')] });
    const r2 = await request(app).put(`${API}/users/${target.id}/roles`).set(auth(admin.token)).send({ roleIds: [role.id] });
    expect(r1.headers['x-request-id']).toBe('req-perm-1');
    const logs = await AppDataSource.getRepository(AuditLog).find({ where: [{ resourceId: role.id }, { resourceId: target.id }] });
    const perm = logs.find((l) => l.action === 'role.permissions.replace');
    const roles = logs.find((l) => l.action === 'user.roles.replace');
    expect(perm).toMatchObject({ actorUserId: admin.user.id, requestId: 'req-perm-1', outcome: 'SUCCESS' });
    expect(perm?.details).toMatchObject({ added: ['dashboard.view'] });
    expect(roles?.requestId).toBe(r2.headers['x-request-id']);

    const api = await request(app).get(`${API}/audit-logs`).query({ resourceId: role.id }).set(auth(admin.token));
    expect(api.status).toBe(200);
    expect(api.body.data.length).toBeGreaterThanOrEqual(1);
  });
});
