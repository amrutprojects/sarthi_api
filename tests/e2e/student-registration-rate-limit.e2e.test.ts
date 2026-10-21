process.env.REGISTRATION_RATE_LIMIT_MAX = '3';

import type { Express } from 'express';
import { API, request, setupTestApp, teardownTestApp } from '../helpers/test-app';

let app: Express;
beforeAll(async () => {
  app = await setupTestApp();
});
afterAll(teardownTestApp);

it('limits public registrations per IP and answers 429 in the standard envelope', async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 4; i++) statuses.push((await request(app).post(`${API}/student-registrations`).send({})).status);
  expect(statuses).toEqual([422, 422, 422, 429]);
  const res = await request(app).post(`${API}/student-registrations`).send({});
  expect(res.body).toMatchObject({ success: false, status: 429, data: null, error: { code: 'RATE_LIMITED' } });
});
