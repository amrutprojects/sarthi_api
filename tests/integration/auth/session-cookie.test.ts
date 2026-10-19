import { randomUUID } from 'crypto';
import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import { appConfig } from '../../../src/config/app.config';
import { API, PASSWORD, auth, createUser, login, request, setupTestApp, teardownTestApp } from '../../helpers/test-app';

let app: Express;
beforeAll(async () => { app = await setupTestApp(); });
afterAll(teardownTestApp);

/* Browser login: token only in an HttpOnly cookie, CSRF header required for state-changing requests (ADR-0003). */
async function browserLogin(email: string) {
  const res = await request(app).post(`${API}/auth/login`).send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = setCookie.find((c) => c.startsWith('amrut_session='));
  return { res, cookie: cookie!.split(';')[0], raw: cookie!, csrf: res.body.data.csrfToken as string };
}

describe('browser session cookie', () => {
  it('sets an HttpOnly SameSite=Strict cookie and does not put the token in the body', async () => {
    const user = await createUser({ roleCodes: ['VIEWER'] });
    const { res, raw, csrf } = await browserLogin(user.email);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Strict/i);
    expect(raw).toMatch(/Path=\//);
    expect(res.body.data.accessToken).toBeUndefined();
    expect(csrf).toEqual(expect.any(String));
  });

  it('authenticates reads with the cookie and returns the same CSRF token from /auth/me', async () => {
    const user = await createUser({ roleCodes: ['VIEWER'] });
    const { cookie, csrf } = await browserLogin(user.email);
    const me = await request(app).get(`${API}/auth/me`).set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.data.csrfToken).toBe(csrf);
  });

  it('rejects state-changing cookie requests without a valid CSRF token', async () => {
    const admin = await createUser({ roleCodes: ['SUPER_ADMIN'] });
    const { cookie, csrf } = await browserLogin(admin.email);
    const body = { name: 'Csrf Role', code: 'CSRF_ROLE' };
    const none = await request(app).post(`${API}/roles`).set('Cookie', cookie).send(body);
    expect(none.status).toBe(403);
    expect(none.body.error.code).toBe('CSRF_INVALID');
    const wrong = await request(app).post(`${API}/roles`).set('Cookie', cookie).set('X-CSRF-Token', 'x'.repeat(43)).send(body);
    expect(wrong.status).toBe(403);
    const ok = await request(app).post(`${API}/roles`).set('Cookie', cookie).set('X-CSRF-Token', csrf).send(body);
    expect(ok.status).toBe(201);
  });

  it('does not require CSRF for bearer-token API clients', async () => {
    const admin = await createUser({ roleCodes: ['SUPER_ADMIN'] });
    const res = await request(app).post(`${API}/roles`).set(auth(await login(admin.email))).send({ name: 'Api Role', code: 'API_ROLE' });
    expect(res.status).toBe(201);
  });

  it('logout clears the cookie and revokes the whole session', async () => {
    const user = await createUser({ roleCodes: ['VIEWER'] });
    const { cookie, csrf } = await browserLogin(user.email);
    const out = await request(app).post(`${API}/auth/logout`).set('Cookie', cookie).set('X-CSRF-Token', csrf);
    expect(out.status).toBe(200);
    expect(([] as string[]).concat(out.headers['set-cookie'] ?? []).join(';')).toMatch(/amrut_session=;/);
    expect((await request(app).get(`${API}/auth/me`).set('Cookie', cookie)).status).toBe(401);
  });

  it('renews a cookie token past half its lifetime, but not after the absolute session limit', async () => {
    const user = await createUser({ roleCodes: ['VIEWER'] });
    const now = Math.floor(Date.now() / 1000);
    const tokenWith = (sst: number) => jwt.sign({ sid: randomUUID(), sst, iat: now - 700, exp: now + 200 }, appConfig.jwt.secret, {
      algorithm: 'HS256', subject: user.id, jwtid: randomUUID(), issuer: appConfig.jwt.issuer, audience: appConfig.jwt.audience,
    });
    const cookieName = appConfig.session.cookieName;
    const fresh = await request(app).get(`${API}/auth/me`).set('Cookie', `${cookieName}=${tokenWith(now - 700)}`);
    expect(fresh.status).toBe(200);
    expect(([] as string[]).concat(fresh.headers['set-cookie'] ?? []).join(';')).toContain(`${cookieName}=ey`);

    const expired = await request(app).get(`${API}/auth/me`).set('Cookie', `${cookieName}=${tokenWith(now - appConfig.session.maxAgeSeconds - 10)}`);
    expect(expired.status).toBe(200);
    expect(expired.headers['set-cookie']).toBeUndefined();
  });
});
