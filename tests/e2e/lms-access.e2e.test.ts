import type { Express } from 'express';
import { HTTP_STATUS } from '../../src/constants/api-response.constants';
import { appConfig } from '../../src/config/app.config';
import { signLmsRequest } from '../../src/modules/lms-access';
import {
  API,
  AppDataSource,
  PASSWORD,
  auth,
  createRoleWith,
  createUser,
  permissionId,
  request,
  resetData,
  setupTestApp,
  superAdmin,
  teardownTestApp,
} from '../helpers/test-app';

let app: Express;
beforeAll(async () => {
  app = await setupTestApp();
});
beforeEach(resetData);
afterAll(teardownTestApp);

const INT = '/integration/v1/lms';

/* A request signed the way the LMS signs it: over the exact body bytes sent. */
function signed(method: 'post' | 'get', path: string, payload?: unknown) {
  const raw = payload === undefined ? '' : JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = signLmsRequest(appConfig.lmsIntegration.secret, method, path, ts, raw);
  const req = request(app)[method](path).set('Authorization', `AMK-HMAC lms:${sig}`).set('X-Timestamp', ts);
  return payload === undefined ? req : req.set('Content-Type', 'application/json').send(raw);
}

async function lmsRole(token: string, codes: string[], code = 'LMS_TRAINER') {
  const created = await request(app).post(`${API}/roles`).set(auth(token)).send({ name: 'LMS Trainer', code, platform: 'LMS' });
  expect(created.status).toBe(HTTP_STATUS.CREATED);
  expect(created.body.data.platform).toBe('LMS');
  const put = await request(app).put(`${API}/lms-access/roles/${created.body.data.id}`).set(auth(token)).send({ codes });
  expect(put.status).toBe(HTTP_STATUS.OK);
  return created.body.data as { id: string; code: string };
}

describe('LMS roles and Admin Panel sign-in for the LMS', () => {
  it('keeps LMS menus on LMS roles and Admin Panel permissions on Admin Panel roles', async () => {
    const { token } = await superAdmin();
    const catalogue = await request(app).get(`${API}/lms-access/catalogue`).set(auth(token));
    expect(catalogue.status).toBe(HTTP_STATUS.OK);
    expect(catalogue.body.data[0].group).toBe('Command Centre');

    const role = await lmsRole(token, ['batch.view', 'batch.create', 'batch.view']);
    const got = await request(app).get(`${API}/lms-access/roles/${role.id}`).set(auth(token));
    expect(got.body.data.codes).toEqual(['batch.create', 'batch.view']);

    const adminPerms = await request(app)
      .put(`${API}/roles/${role.id}/permissions`)
      .set(auth(token))
      .send({ permissionIds: [await permissionId('dashboard.view')] });
    expect(adminPerms.status).toBe(HTTP_STATUS.BAD_REQUEST);

    const adminRole = await createRoleWith(['dashboard.view']);
    const onAdmin = await request(app)
      .put(`${API}/lms-access/roles/${adminRole.id}`)
      .set(auth(token))
      .send({ codes: ['batch.view'] });
    expect(onAdmin.status).toBe(HTTP_STATUS.BAD_REQUEST);

    const unknown = await request(app)
      .put(`${API}/lms-access/roles/${role.id}`)
      .set(auth(token))
      .send({ codes: ['dashboard.approve.all'] });
    expect(unknown.status).toBe(HTTP_STATUS.BAD_REQUEST);

    /* Sensitive LMS codes are granted only inside the LMS, never on an Admin Panel LMS role. */
    const sensitive = await request(app)
      .put(`${API}/lms-access/roles/${role.id}`)
      .set(auth(token))
      .send({ codes: ['batch.view', 'certificate.approve', 'iam.permission.status'] });
    expect(sensitive.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(sensitive.body.error.details.map((d: { message: string }) => d.message)).toEqual([
      'certificate.approve',
      'iam.permission.status',
    ]);

    /* A role switches application only once it carries nothing of its current kind. */
    const busy = await request(app).patch(`${API}/roles/${adminRole.id}`).set(auth(token)).send({ platform: 'LMS' });
    expect(busy.status).toBe(HTTP_STATUS.BAD_REQUEST);
    const empty = await createRoleWith([]);
    const switched = await request(app).patch(`${API}/roles/${empty.id}`).set(auth(token)).send({ platform: 'LMS' });
    expect(switched.status).toBe(HTTP_STATUS.OK);
    expect(switched.body.data.platform).toBe('LMS');
  });

  it('signs an Admin Panel user in to the LMS with only the LMS menus of their LMS roles', async () => {
    const { token } = await superAdmin();
    const role = await lmsRole(token, ['batch.view', 'attendance.view']);
    const second = await lmsRole(token, ['oft.view'], 'LMS_OFT_REVIEWER');
    const adminRole = await createRoleWith(['dashboard.view']);
    const user = await createUser({ roleCodes: [role.code, second.code, adminRole.code] });

    const ok = await signed('post', `${INT}/sign-in`, { identifier: user.email, password: PASSWORD });
    expect(ok.status).toBe(HTTP_STATUS.OK);
    expect(ok.body.data).toMatchObject({
      user: { id: user.id, email: user.email },
      active: true,
      lmsPermissions: ['attendance.view', 'batch.view', 'oft.view'],
    });
    /* Each LMS role carries only its own codes, so the LMS can mirror roles separately; the Admin Panel role is never sent. */
    const byCode = Object.fromEntries(
      (ok.body.data.roles as { code: string; lmsPermissions: string[] }[]).map((r) => [r.code, r.lmsPermissions]),
    );
    expect(byCode).toEqual({ [role.code]: ['attendance.view', 'batch.view'], [second.code]: ['oft.view'] });

    /* A sensitive code that reached the table some other way is never shown or handed to the LMS. */
    await AppDataSource.query(`INSERT INTO "role_lms_permissions" ("roleId", "code") VALUES ($1, 'certificate.approve')`, [role.id]);
    const shown = await request(app).get(`${API}/lms-access/roles/${role.id}`).set(auth(token));
    expect(shown.body.data.codes).not.toContain('certificate.approve');

    const access = await signed('get', `${INT}/users/${user.id}/access`);
    expect(access.status).toBe(HTTP_STATUS.OK);
    expect(access.body.data.lmsPermissions).toEqual(['attendance.view', 'batch.view', 'oft.view']);
    expect(access.body.data.roles).toHaveLength(2);

    await request(app).patch(`${API}/users/${user.id}/status`).set(auth(token)).send({ isActive: false });
    const after = await signed('get', `${INT}/users/${user.id}/access`);
    expect(after.body.data).toMatchObject({ active: false, lmsPermissions: [] });
  });

  it('refuses wrong passwords, users without an LMS role and unsigned calls', async () => {
    const { token } = await superAdmin();
    const role = await lmsRole(token, ['batch.view']);
    const lmsUser = await createUser({ roleCodes: [role.code] });
    const adminOnly = await createUser({ roleCodes: [(await createRoleWith(['dashboard.view'])).code] });

    const wrong = await signed('post', `${INT}/sign-in`, { identifier: lmsUser.email, password: 'not-the-password' });
    expect(wrong.status).toBe(HTTP_STATUS.UNAUTHORIZED);
    const unknown = await signed('post', `${INT}/sign-in`, { identifier: 'nobody@test.local', password: PASSWORD });
    expect(unknown.status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(unknown.body.message).toBe(wrong.body.message);

    const noLms = await signed('post', `${INT}/sign-in`, { identifier: adminOnly.email, password: PASSWORD });
    expect(noLms.status).toBe(HTTP_STATUS.FORBIDDEN);
    expect(noLms.body.error.code).toBe('NO_LMS_ACCESS');

    const unsigned = await request(app).post(`${INT}/sign-in`).send({ identifier: lmsUser.email, password: PASSWORD });
    expect(unsigned.status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(unsigned.body.error.code).toBe('SIGNATURE_INVALID');
  });
});
