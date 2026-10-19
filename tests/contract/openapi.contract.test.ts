import type { Express, Router } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { documentedRoutes } from '../../src/openapi';
import { apiRouter } from '../../src/routes';
import { envelope, pagedEnvelope } from '../../src/shared/openapi/registry';
import { RoleRefDto, UserDto } from '../../src/modules/users/user.openapi';
import { PermissionDto, RoleDto } from '../../src/modules/roles-permissions/roles-permissions.openapi';
import { API, auth, createUser, login, request, setupTestApp, superAdmin, teardownTestApp } from '../helpers/test-app';

let app: Express;
beforeAll(async () => { app = await setupTestApp(); });
afterAll(teardownTestApp);

interface Layer { route?: { path: string; methods: Record<string, boolean> }; regexp: RegExp; handle: Router & { stack?: Layer[] } }

/* Every route registered on the Express API router, as "METHOD /path". */
function expressRoutes(): string[] {
  const out: string[] = [];
  for (const layer of (apiRouter as unknown as { stack: Layer[] }).stack) {
    const mount = layer.regexp.source.replace('^\\', '').replace('\\/?(?=\\/|$)', '').replace(/\\\//g, '/');
    for (const inner of layer.handle.stack ?? []) {
      if (!inner.route) continue;
      for (const m of Object.keys(inner.route.methods)) out.push(`${m.toUpperCase()} /${mount}${inner.route.path === '/' ? '' : inner.route.path}`.replace('//', '/'));
    }
  }
  return out.sort();
}

describe('OpenAPI contract', () => {
  it('documents every Express route, and documents no route that does not exist', () => {
    const actual = expressRoutes();
    const documented = documentedRoutes.map((r) => `${r.method.toUpperCase()} ${r.path}`).sort();
    expect(actual.length).toBeGreaterThan(40);
    expect(actual.filter((r) => !documented.includes(r))).toEqual([]);
    expect(documented.filter((r) => !actual.includes(r))).toEqual([]);
  });

  it('serves a valid OpenAPI 3 document with security schemes and permissions', async () => {
    const res = await request(app).get(`${API}/openapi.json`);
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');
    expect(Object.keys(res.body.paths).length).toBeGreaterThan(30);
    expect(res.body.components.securitySchemes).toHaveProperty('cookieAuth');
    expect(res.body.paths['/api/v1/users'].post['x-permissions']).toEqual(['users.create']);
  });

  /* Real responses must match the documented response schemas. */
  const check = (schema: ZodTypeAny, body: unknown) => {
    const r = schema.safeParse(body);
    if (!r.success) throw new Error(JSON.stringify(r.error.issues.slice(0, 5), null, 2));
  };

  it('users endpoints return exactly the documented DTOs', async () => {
    const admin = await superAdmin();
    const created = await request(app).post(`${API}/users`).set(auth(admin.token)).send({ name: 'Contract User', email: 'contract@test.local', password: 'Contract-Pass-1' });
    check(envelope(UserDto), created.body);
    check(pagedEnvelope(UserDto), (await request(app).get(`${API}/users`).set(auth(admin.token))).body);
    check(envelope(UserDto), (await request(app).get(`${API}/users/${created.body.data.id}`).set(auth(admin.token))).body);
    check(envelope(z.array(RoleRefDto)), (await request(app).get(`${API}/users/${created.body.data.id}/roles`).set(auth(admin.token))).body);
  });

  it('roles and permissions endpoints return the documented DTOs', async () => {
    const admin = await superAdmin();
    check(pagedEnvelope(RoleDto), (await request(app).get(`${API}/roles`).set(auth(admin.token))).body);
    check(pagedEnvelope(PermissionDto), (await request(app).get(`${API}/permissions`).set(auth(admin.token))).body);
  });

  it('errors use the documented error envelope', async () => {
    const viewer = await createUser({ roleCodes: ['VIEWER'] });
    const res = await request(app).post(`${API}/users`).set(auth(await login(viewer.email))).send({});
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, message: expect.any(String), error: { code: 'FORBIDDEN', requestId: expect.any(String) } });
  });
});
