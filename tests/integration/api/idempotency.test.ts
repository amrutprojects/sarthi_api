import type { Express } from 'express';
import { API, auth, createUser, login, request, setupTestApp, teardownTestApp } from '../../helpers/test-app';

let app: Express;
let token: string;
beforeAll(async () => {
  app = await setupTestApp();
  token = await login((await createUser({ roleCodes: ['SUPER_ADMIN'] })).email);
});
afterAll(teardownTestApp);

const createRole = (key: string | null, body: object) => {
  const r = request(app).post(`${API}/roles`).set(auth(token));
  if (key) r.set('Idempotency-Key', key);
  return r.send(body);
};

describe('Idempotency-Key', () => {
  it('replays the first response for a retry and creates the record once', async () => {
    const body = { name: 'Retry Role', code: 'RETRY_ROLE' };
    const first = await createRole('retry-key-0001', body);
    expect(first.status).toBe(201);
    const retry = await createRole('retry-key-0001', body);
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.data.id).toBe(first.body.data.id);
    /* Without the key, the same request is a conflict: the role was created only once. */
    expect((await createRole(null, body)).status).toBe(409);
  });

  it('rejects the same key with a different body, and malformed keys', async () => {
    await createRole('reuse-key-0001', { name: 'One', code: 'ONE_ROLE' });
    const other = await createRole('reuse-key-0001', { name: 'Two', code: 'TWO_ROLE' });
    expect(other.status).toBe(422);
    expect(other.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await createRole('bad key!', { name: 'Three', code: 'THREE_ROLE' })).status).toBe(400);
  });

  it('keys are per user', async () => {
    const otherToken = await login((await createUser({ roleCodes: ['SUPER_ADMIN'] })).email);
    await createRole('shared-key-0001', { name: 'Mine', code: 'MINE_ROLE' });
    const theirs = await request(app)
      .post(`${API}/roles`)
      .set(auth(otherToken))
      .set('Idempotency-Key', 'shared-key-0001')
      .send({ name: 'Theirs', code: 'THEIRS_ROLE' });
    expect(theirs.status).toBe(201);
    expect(theirs.headers['idempotent-replayed']).toBeUndefined();
  });
});
