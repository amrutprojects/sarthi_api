import type { Express } from 'express';
import { API, request, setupTestApp, teardownTestApp } from '../../helpers/test-app';

let app: Express;
beforeAll(async () => {
  app = await setupTestApp();
});
afterAll(teardownTestApp);

describe('API standards', () => {
  it('GET /health reports the database as up', async () => {
    const res = await request(app).get(`${API}/health`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { status: 'ok', database: 'up' } });
  });

  it('GET /health/live answers without touching the database; /health/ready checks database and migrations', async () => {
    const live = await request(app).get(`${API}/health/live`);
    expect(live.status).toBe(200);
    expect(live.body.data).toEqual({ status: 'ok', uptimeSeconds: expect.any(Number) });
    const ready = await request(app).get(`${API}/health/ready`);
    expect(ready.status).toBe(200);
    expect(ready.body.data).toMatchObject({ database: 'up', migrations: 'current' });
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(app).get(`${API}/does-not-exist`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'ROUTE_NOT_FOUND' } });
  });

  it('adds a request id to every response and echoes a provided one', async () => {
    const gen = await request(app).get(`${API}/health`);
    expect(gen.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const echo = await request(app).get(`${API}/health`).set('X-Request-Id', 'trace-abc_123');
    expect(echo.headers['x-request-id']).toBe('trace-abc_123');
    const unsafe = await request(app).get(`${API}/health`).set('X-Request-Id', 'bad id <script>');
    expect(unsafe.headers['x-request-id']).not.toBe('bad id <script>');
  });

  it('sets security headers (Helmet) and hides X-Powered-By', async () => {
    const res = await request(app).get(`${API}/health`);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows configured CORS origins only', async () => {
    const ok = await request(app)
      .options(`${API}/health`)
      .set('Origin', 'http://localhost:5174')
      .set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5174');
    const bad = await request(app)
      .options(`${API}/health`)
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects malformed JSON with 400 and a generic message', async () => {
    const res = await request(app).post(`${API}/auth/login`).set('Content-Type', 'application/json').send('{"email": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(JSON.stringify(res.body)).not.toMatch(/SyntaxError|at JSON\.parse/);
  });

  it('applies the rate-limit headers', async () => {
    const res = await request(app).get(`${API}/health`);
    expect(res.headers['ratelimit-policy'] ?? res.headers.ratelimit).toBeDefined();
  });
});
