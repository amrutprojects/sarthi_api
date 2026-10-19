import type { Express } from 'express';
import { User } from '../../../src/database/entities';
import {
  API, AppDataSource, PASSWORD, actorWith, auth, createUser, request, roleId, setupTestApp, superAdmin, teardownTestApp, type TestActor,
} from '../../helpers/test-app';

let app: Express;
let admin: TestActor;
beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
});
afterAll(teardownTestApp);

const newUser = (over: Record<string, unknown> = {}) => ({
  name: 'Asha Patil', email: `asha.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@test.local`, password: 'Strong-Pass-123', ...over,
});

describe('user CRUD', () => {
  it('creates a user (201), hashes the password and never returns it', async () => {
    const body = newUser();
    const res = await request(app).post(`${API}/users`).set(auth(admin.token)).send(body);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: body.name, email: body.email, isActive: true });
    expect(res.body.data).not.toHaveProperty('passwordHash');
    const row = await AppDataSource.getRepository(User).createQueryBuilder('u').addSelect('u.passwordHash').where('u.id = :id', { id: res.body.data.id }).getOneOrFail();
    expect(row.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(row.passwordHash).not.toContain(body.password);
  });

  it('creates a user with roles in one transaction', async () => {
    const res = await request(app).post(`${API}/users`).set(auth(admin.token)).send(newUser({ roleIds: [await roleId('VIEWER')] }));
    expect(res.status).toBe(201);
    expect(res.body.data.roles.map((r: { code: string }) => r.code)).toEqual(['VIEWER']);
  });

  it('rolls back the user when a role in the same request is invalid', async () => {
    const body = newUser({ roleIds: [await roleId('VIEWER'), '00000000-0000-4000-8000-000000000000'] });
    const res = await request(app).post(`${API}/users`).set(auth(admin.token)).send(body);
    expect(res.status).toBe(400);
    expect(await AppDataSource.getRepository(User).countBy({ email: body.email })).toBe(0);
  });

  it('rejects a duplicate email (409), case-insensitively', async () => {
    const body = newUser();
    await request(app).post(`${API}/users`).set(auth(admin.token)).send(body).expect(201);
    const res = await request(app).post(`${API}/users`).set(auth(admin.token)).send({ ...body, email: body.email.toUpperCase() });
    expect(res.status).toBe(409);
  });

  it('validates input and enforces the password policy (422)', async () => {
    const res = await request(app).post(`${API}/users`).set(auth(admin.token)).send({ name: '', email: 'bad', password: 'short' });
    expect(res.status).toBe(422);
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['body.name', 'body.email', 'body.password']));
  });

  it('lists users with pagination, search and the standard envelope', async () => {
    const marker = `zeta${Date.now()}`;
    for (let i = 0; i < 3; i++) await createUser({ name: `${marker} ${i}` });
    const res = await request(app).get(`${API}/users`).query({ search: marker, page: 1, limit: 2, sortBy: 'name', sortOrder: 'asc' }).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: 'Users retrieved successfully' });
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(res.body.data[0].name).toBe(`${marker} 0`);
  });

  it('rejects an unknown sort field and an out-of-range limit', async () => {
    expect((await request(app).get(`${API}/users`).query({ sortBy: 'passwordHash' }).set(auth(admin.token))).status).toBe(422);
    expect((await request(app).get(`${API}/users`).query({ limit: 1000 }).set(auth(admin.token))).status).toBe(422);
  });

  it('treats search text literally (no LIKE wildcards / injection)', async () => {
    const res = await request(app).get(`${API}/users`).query({ search: "%' OR 1=1 --" }).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('gets, updates and changes a password', async () => {
    const u = await createUser();
    const got = await request(app).get(`${API}/users/${u.id}`).set(auth(admin.token));
    expect(got.status).toBe(200);
    const upd = await request(app).patch(`${API}/users/${u.id}`).set(auth(admin.token)).send({ name: 'Renamed', password: 'New-Password-456' });
    expect(upd.status).toBe(200);
    expect(upd.body.data.name).toBe('Renamed');
    const loginRes = await request(app).post(`${API}/auth/login`).send({ email: u.email, password: 'New-Password-456' });
    expect(loginRes.status).toBe(200);
  });

  it('404 for an unknown id and 422 for a malformed id', async () => {
    expect((await request(app).get(`${API}/users/00000000-0000-4000-8000-000000000000`).set(auth(admin.token))).status).toBe(404);
    expect((await request(app).get(`${API}/users/not-a-uuid`).set(auth(admin.token))).status).toBe(422);
  });

  it('deactivates and reactivates a user; an inactive user cannot log in', async () => {
    const u = await createUser();
    expect((await request(app).patch(`${API}/users/${u.id}/status`).set(auth(admin.token)).send({ isActive: false })).body.data.isActive).toBe(false);
    expect((await request(app).post(`${API}/auth/login`).send({ email: u.email, password: PASSWORD })).status).toBe(401);
    expect((await request(app).patch(`${API}/users/${u.id}/status`).set(auth(admin.token)).send({ isActive: true })).body.data.isActive).toBe(true);
    expect((await request(app).post(`${API}/auth/login`).send({ email: u.email, password: PASSWORD })).status).toBe(200);
  });
});

describe('user soft delete and restore', () => {
  it('soft-deletes: hidden from get/list, row kept with isDelete=true, isActive=false', async () => {
    const u = await createUser({ name: `Deleted ${Date.now()}` });
    expect((await request(app).delete(`${API}/users/${u.id}`).set(auth(admin.token))).status).toBe(200);
    expect((await request(app).get(`${API}/users/${u.id}`).set(auth(admin.token))).status).toBe(404);
    const list = await request(app).get(`${API}/users`).query({ search: u.name }).set(auth(admin.token));
    expect(list.body.data).toHaveLength(0);
    const row = await AppDataSource.getRepository(User).findOneByOrFail({ id: u.id });
    expect(row).toMatchObject({ isDelete: true, isActive: false });
    expect((await request(app).delete(`${API}/users/${u.id}`).set(auth(admin.token))).status).toBe(404);
  });

  it('frees the email for a new account', async () => {
    const u = await createUser();
    await request(app).delete(`${API}/users/${u.id}`).set(auth(admin.token)).expect(200);
    const res = await request(app).post(`${API}/users`).set(auth(admin.token)).send(newUser({ email: u.email }));
    expect(res.status).toBe(201);
  });

  it('restores as inactive (requires users.restore) and refuses when the email is taken again', async () => {
    const u = await createUser();
    await request(app).delete(`${API}/users/${u.id}`).set(auth(admin.token)).expect(200);
    const res = await request(app).post(`${API}/users/${u.id}/restore`).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);

    const v = await createUser();
    await request(app).delete(`${API}/users/${v.id}`).set(auth(admin.token)).expect(200);
    await request(app).post(`${API}/users`).set(auth(admin.token)).send(newUser({ email: v.email })).expect(201);
    expect((await request(app).post(`${API}/users/${v.id}/restore`).set(auth(admin.token))).status).toBe(409);
  });

  it('prevents deleting or deactivating yourself', async () => {
    expect((await request(app).delete(`${API}/users/${admin.user.id}`).set(auth(admin.token))).status).toBe(403);
    expect((await request(app).patch(`${API}/users/${admin.user.id}/status`).set(auth(admin.token)).send({ isActive: false })).status).toBe(403);
  });

  it('requires users.delete to delete', async () => {
    const viewer = await actorWith(['users.view']);
    const u = await createUser();
    expect((await request(app).delete(`${API}/users/${u.id}`).set(auth(viewer.token))).status).toBe(403);
  });
});

describe('GET /users roles', () => {
  it('includes each user\'s roles for callers with roles.view, and omits them otherwise', async () => {
    const { request: req, API: api, auth: au, createUser: cu, login: li } = await import('../../helpers/test-app');
    const admin = await cu({ roleCodes: ['SUPER_ADMIN'] });
    await cu({ roleCodes: ['TRAINER'] });
    const withRoles = await req(app).get(`${api}/users?limit=100`).set(au(await li(admin.email)));
    expect(withRoles.status).toBe(200);
    const trainer = withRoles.body.data.find((u: { roles?: { code: string }[] }) => u.roles?.some((r) => r.code === 'TRAINER'));
    expect(trainer).toBeDefined();

    const limited = await cu({ roleCodes: [] });
    const role = await (await import('../../helpers/test-app')).createRoleWith(['users.view']);
    await (await import('../../../src/config/database.config')).AppDataSource.query('INSERT INTO "user_roles" ("userId","roleId") VALUES ($1,$2)', [limited.id, role.id]);
    const without = await req(app).get(`${api}/users?limit=100`).set(au(await li(limited.email)));
    expect(without.status).toBe(200);
    expect(without.body.data[0].roles).toBeUndefined();
  });
});
