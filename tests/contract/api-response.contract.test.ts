import type { Express } from 'express';
import { HTTP_STATUS } from '../../src/constants/api-response.constants';
import { API, auth, request, setupTestApp, superAdmin, teardownTestApp } from '../helpers/test-app';

let app: Express;
beforeAll(async () => {
  app = await setupTestApp();
});
afterAll(teardownTestApp);

/* Every JSON response carries { success, status, message, data }, and `status` equals the HTTP status. */
function expectEnvelope(res: { status: number; body: Record<string, unknown> }, expected: number) {
  expect(res.status).toBe(expected);
  expect(res.body.status).toBe(res.status);
  expect(typeof res.body.message).toBe('string');
  expect(res.body).toHaveProperty('data');
  expect(res.body.success).toBe(res.status < HTTP_STATUS.BAD_REQUEST);
  if (!res.body.success) expect(res.body.data).toBeNull();
}

describe('API response envelope', () => {
  it('200 on liveness', async () => {
    expectEnvelope(await request(app).get(`${API}/health/live`), HTTP_STATUS.OK);
  });

  it('404 on an unknown route', async () => {
    expectEnvelope(await request(app).get(`${API}/no-such-route`), HTTP_STATUS.NOT_FOUND);
  });

  it('401 without credentials', async () => {
    expectEnvelope(await request(app).get(`${API}/users`), HTTP_STATUS.UNAUTHORIZED);
  });

  it('400 on malformed JSON', async () => {
    const res = await request(app).post(`${API}/auth/login`).set('Content-Type', 'application/json').send('{bad');
    expectEnvelope(res, HTTP_STATUS.BAD_REQUEST);
  });

  it('422 on a validation failure, and 201 on create', async () => {
    const admin = await superAdmin();
    expectEnvelope(await request(app).post(`${API}/roles`).set(auth(admin.token)).send({}), HTTP_STATUS.UNPROCESSABLE_ENTITY);
    const res = await request(app)
      .post(`${API}/roles`)
      .set(auth(admin.token))
      .send({ code: 'ENVELOPE_TEST_ROLE', name: 'Envelope test role' });
    expectEnvelope(res, HTTP_STATUS.CREATED);
  });
});
