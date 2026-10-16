import jwt from 'jsonwebtoken';
import type { Express } from 'express';
import { appConfig } from '../../src/config/app.config';
import { AuditLog, User } from '../../src/entities';
import { userRepository } from '../../src/repositories/user.repository';
import { authService } from '../../src/services/auth.service';
import {
  API, AppDataSource, PASSWORD, auth, createUser, login, request, setupTestApp, superAdmin, teardownTestApp,
} from '../helpers/test-app';

let app: Express;
beforeAll(async () => { app = await setupTestApp(); });
afterAll(teardownTestApp);

describe('POST /auth/login', () => {
  it('returns a bearer token and the user without the password hash', async () => {
    const user = await createUser({ roleCodes: ['VIEWER'] });
    const res = await request(app).post(`${API}/auth/login`).send({ email: user.email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tokenType).toBe('Bearer');
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user.email).toBe(user.email);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('records lastLoginAt and an auth.login audit entry', async () => {
    const user = await createUser();
    await login(user.email);
    expect((await AppDataSource.getRepository(User).findOneByOrFail({ id: user.id })).lastLoginAt).toBeInstanceOf(Date);
    expect(await AppDataSource.getRepository(AuditLog).countBy({ action: 'auth.login', actorUserId: user.id })).toBe(1);
  });

  it('uses one generic message for a wrong password and an unknown email', async () => {
    const user = await createUser();
    const wrong = await request(app).post(`${API}/auth/login`).send({ email: user.email, password: 'Wrong-Password-1' });
    const unknown = await request(app).post(`${API}/auth/login`).send({ email: 'nobody@test.local', password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe('Invalid email or password');
    expect(unknown.body.message).toBe(wrong.body.message);
  });

  it('rejects inactive and soft-deleted users with the same generic message', async () => {
    const inactive = await createUser({ isActive: false });
    const deleted = await createUser();
    await userRepository.softDelete(deleted.id);
    for (const u of [inactive, deleted]) {
      const res = await request(app).post(`${API}/auth/login`).send({ email: u.email, password: PASSWORD });
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid email or password');
    }
  });

  it('validates the request body (422)', async () => {
    const res = await request(app).post(`${API}/auth/login`).send({ email: 'not-an-email', password: '' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toEqual(expect.arrayContaining(['body.email', 'body.password']));
  });

  it('rejects unknown fields (strict schema)', async () => {
    const res = await request(app).post(`${API}/auth/login`).send({ email: 'a@test.local', password: 'x', isAdmin: true });
    expect(res.status).toBe(422);
  });

  it('never writes the password to the audit log', async () => {
    const user = await createUser();
    await request(app).post(`${API}/auth/login`).send({ email: user.email, password: 'Leaky-Password-9' });
    const rows = await AppDataSource.getRepository(AuditLog).findBy({ resourceId: user.id });
    expect(JSON.stringify(rows)).not.toContain('Leaky-Password-9');
  });
});

describe('authenticated endpoints', () => {
  it('GET /auth/me returns the user, roles and permissions', async () => {
    const admin = await superAdmin();
    const res = await request(app).get(`${API}/auth/me`).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(admin.user.id);
    expect(res.body.data.roles.map((r: { code: string }) => r.code)).toContain('SUPER_ADMIN');
    expect(res.body.data.permissions).toContain('users.view');
    expect(res.body.data).not.toHaveProperty('passwordHash');
  });

  it('GET /auth/permissions returns effective permissions only', async () => {
    const user = await createUser({ roleCodes: ['TRAINER'] });
    const res = await request(app).get(`${API}/auth/permissions`).set(auth(await login(user.email)));
    expect(res.status).toBe(200);
    expect(res.body.data.roles).toEqual(['TRAINER']);
    expect(res.body.data.permissions).toContain('attendance.create');
    expect(res.body.data.permissions).not.toContain('users.view');
  });

  it('401 without a token, with a malformed header or with garbage', async () => {
    for (const h of [undefined, 'Basic abc', 'Bearer', 'Bearer not.a.jwt']) {
      const req = request(app).get(`${API}/auth/me`);
      if (h) req.set('Authorization', h);
      const res = await req;
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    }
  });

  it('401 for a token signed with another secret, wrong issuer / audience, or expired', async () => {
    const user = await createUser();
    const base = { subject: user.id, jwtid: '7d1b7a56-7b8e-4a4e-9b0a-1f2e3d4c5b6a', algorithm: 'HS256' as const };
    const tokens = [
      jwt.sign({}, 'x'.repeat(40), { ...base, issuer: appConfig.jwt.issuer, audience: appConfig.jwt.audience, expiresIn: '5m' }),
      jwt.sign({}, appConfig.jwt.secret, { ...base, issuer: 'evil', audience: appConfig.jwt.audience, expiresIn: '5m' }),
      jwt.sign({}, appConfig.jwt.secret, { ...base, issuer: appConfig.jwt.issuer, audience: 'other-app', expiresIn: '5m' }),
      jwt.sign({ exp: Math.floor(Date.now() / 1000) - 10 }, appConfig.jwt.secret, { subject: base.subject, jwtid: base.jwtid, issuer: appConfig.jwt.issuer, audience: appConfig.jwt.audience }),
    ];
    for (const t of tokens) {
      expect((await request(app).get(`${API}/auth/me`).set(auth(t))).status).toBe(401);
    }
  });

  it('401 with the "none" algorithm', async () => {
    const user = await createUser();
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: user.id, jti: 'x', iss: appConfig.jwt.issuer, aud: appConfig.jwt.audience, exp: 9999999999 })).toString('base64url');
    expect((await request(app).get(`${API}/auth/me`).set(auth(`${header}.${payload}.`))).status).toBe(401);
  });

  it('rejects a valid token once the user is deactivated or deleted', async () => {
    const a = await createUser();
    const b = await createUser();
    const ta = await login(a.email);
    const tb = await login(b.email);
    await userRepository.update(a.id, { isActive: false });
    await userRepository.softDelete(b.id);
    expect((await request(app).get(`${API}/auth/me`).set(auth(ta))).status).toBe(401);
    expect((await request(app).get(`${API}/auth/me`).set(auth(tb))).status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('revokes the token used, but not other sessions', async () => {
    const user = await createUser();
    const t1 = await login(user.email);
    const t2 = await login(user.email);
    const out = await request(app).post(`${API}/auth/logout`).set(auth(t1));
    expect(out.status).toBe(200);
    expect((await request(app).get(`${API}/auth/me`).set(auth(t1))).status).toBe(401);
    expect((await request(app).get(`${API}/auth/me`).set(auth(t2))).status).toBe(200);
  });

  it('requires authentication', async () => {
    expect((await request(app).post(`${API}/auth/logout`)).status).toBe(401);
  });

  it('issues tokens with unique jti, issuer, audience and expiry', () => {
    const { payload } = authService.signAccessToken('3f1d0a52-1111-4a4a-9a9a-000000000001');
    const { payload: p2 } = authService.signAccessToken('3f1d0a52-1111-4a4a-9a9a-000000000001');
    expect(payload.jti).not.toBe(p2.jti);
    expect(payload.iss).toBe(appConfig.jwt.issuer);
    expect(payload.aud).toBe(appConfig.jwt.audience);
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });
});
