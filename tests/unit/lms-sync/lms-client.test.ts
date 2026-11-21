import { LmsError, backoffDelay, createLmsClient, parseRetryAfter, tenantBaseUrl } from '../../../src/modules/lms-sync/lms-client';

const KEY = 'unit-test-tenant-key-DO-NOT-LOG-0123456789';

interface Planned {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  throws?: boolean;
}

/* A fetch double answering from a script and recording each call. */
function fakeFetch(plan: Planned[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const p = plan.shift() ?? { status: 500 };
    if (p.throws) throw new Error(`connect ECONNREFUSED with ${KEY}`);
    return new Response(p.body === undefined ? '' : JSON.stringify(p.body), { status: p.status ?? 200, headers: p.headers });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const answer = { intake_request_id: '5f0c2a8e-6b1d-4c43-9a51-0d6c1e9b7a10', accepted: 1, rejected: [] };

function client(plan: Planned[], extra: Partial<Parameters<typeof createLmsClient>[0]> = {}) {
  const f = fakeFetch(plan);
  const sleeps: number[] = [];
  const c = createLmsClient({
    baseUrl: 'https://lms.example.test/',
    apiKey: KEY,
    timeoutMs: 1_000,
    fetchImpl: f.impl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
    ...extra,
  });
  return { c, calls: f.calls, sleeps };
}

describe('backoff with jitter', () => {
  it('grows exponentially, stays within [half, full] of the step and respects the cap', () => {
    expect(backoffDelay(0, 1000, 30_000, () => 0)).toBe(500);
    expect(backoffDelay(0, 1000, 30_000, () => 1)).toBe(1000);
    expect(backoffDelay(3, 1000, 30_000, () => 0)).toBe(4000);
    expect(backoffDelay(3, 1000, 30_000, () => 1)).toBe(8000);
    expect(backoffDelay(20, 1000, 30_000, () => 1)).toBe(30_000);
    for (let i = 0; i < 200; i++) {
      const d = backoffDelay(2, 1000, 30_000);
      expect(d).toBeGreaterThanOrEqual(2000);
      expect(d).toBeLessThanOrEqual(4000);
    }
  });

  it('reads Retry-After as seconds or an HTTP date', () => {
    expect(parseRetryAfter('120')).toBe(120_000);
    expect(parseRetryAfter(new Date(10_000 + 30_000).toUTCString(), 10_000)).toBe(30_000);
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });

  it('builds the tenant base URL', () => {
    expect(tenantBaseUrl('https://lms.example.test')).toBe('https://lms.example.test/tenant/v1');
    expect(tenantBaseUrl('https://lms.example.test/tenant/v1/')).toBe('https://lms.example.test/tenant/v1');
  });
});

describe('LMS client', () => {
  it('sends the key header, an Idempotency-Key and the schema envelope', async () => {
    const { c, calls } = client([{ status: 202, body: answer }]);
    await expect(c.sendStudents([{ external_student_id: 'a' }], 'req-1', 'idem-1')).resolves.toMatchObject({ accepted: 1 });
    expect(calls[0].url).toBe('https://lms.example.test/tenant/v1/students');
    const h = calls[0].init.headers as Record<string, string>;
    expect(h['X-Api-Key']).toBe(KEY);
    expect(h['Idempotency-Key']).toBe('idem-1');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      schema_version: 1,
      request_id: 'req-1',
      records: [{ external_student_id: 'a' }],
    });
    expect(calls[0].url).not.toContain(KEY);
  });

  it('retries 5xx and network errors with backoff, the same Idempotency-Key each time', async () => {
    const { c, calls, sleeps } = client([{ status: 503 }, { throws: true }, { status: 202, body: answer }], { baseDelayMs: 1000 });
    await c.sendStudents([{ external_student_id: 'a' }], 'req-1', 'idem-1');
    expect(calls).toHaveLength(3);
    expect(calls.map((x) => (x.init.headers as Record<string, string>)['Idempotency-Key'])).toEqual(['idem-1', 'idem-1', 'idem-1']);
    expect(calls.map((x) => x.init.body)).toEqual([calls[0].init.body, calls[0].init.body, calls[0].init.body]);
    expect(sleeps).toEqual([750, 1500]);
  });

  it('honours Retry-After on 429', async () => {
    const { c, sleeps } = client([
      { status: 429, headers: { 'Retry-After': '7' }, body: { error: { code: 'RATE_LIMITED' } } },
      { status: 202, body: answer },
    ]);
    await c.sendStudents([{ external_student_id: 'a' }], 'r', 'k');
    expect(sleeps).toEqual([7000]);
  });

  it('does not wait out a long Retry-After: fails retryable with retryAfterMs', async () => {
    const { c, calls } = client([{ status: 429, headers: { 'Retry-After': '3600' }, body: { error: { code: 'INTAKE_QUOTA_EXCEEDED' } } }]);
    const err = (await c.sendStudents([{ external_student_id: 'a' }], 'r', 'k').catch((e) => e)) as LmsError;
    expect(err).toBeInstanceOf(LmsError);
    expect(err).toMatchObject({ code: 'INTAKE_QUOTA_EXCEEDED', retryable: true, status: 429, retryAfterMs: 3_600_000 });
    expect(calls).toHaveLength(1);
  });

  it('gives up after maxRetries', async () => {
    const { c, calls } = client([{ status: 500 }, { status: 500 }, { status: 500 }], { maxRetries: 2 });
    await expect(c.sendStudents([{ external_student_id: 'a' }], 'r', 'k')).rejects.toMatchObject({ code: 'HTTP_500', retryable: true });
    expect(calls).toHaveLength(3);
  });

  it('never retries other 4xx and keeps only codes from the error envelope', async () => {
    const { c, calls } = client([
      {
        status: 400,
        body: {
          error: {
            code: 'UNEXPECTED_FIELD',
            message: 'x',
            details: [{ field: 'caste', code: 'unexpected', value: 'leak' }],
            request_id: 'rq-1',
          },
        },
      },
    ]);
    const err = (await c.sendStudents([{ external_student_id: 'a' }], 'r', 'k').catch((e) => e)) as LmsError;
    expect(calls).toHaveLength(1);
    expect(err).toMatchObject({ code: 'UNEXPECTED_FIELD', retryable: false, status: 400, lmsRequestId: 'rq-1' });
    expect(err.details).toEqual([{ field: 'caste', code: 'unexpected' }]);
  });

  it('times out a hanging call', async () => {
    const hanging = ((_u: string, init: RequestInit) =>
      new Promise((_resolve, reject) =>
        init.signal!.addEventListener('abort', () => reject(new Error('aborted'))),
      )) as unknown as typeof fetch;
    const c = createLmsClient({ baseUrl: 'https://lms.example.test', apiKey: KEY, timeoutMs: 20, fetchImpl: hanging, maxRetries: 0 });
    await expect(c.getStudent('x')).rejects.toMatchObject({ code: 'LMS_TIMEOUT', retryable: true });
  });

  it('never puts the key in an error', async () => {
    const { c } = client([{ throws: true }], { maxRetries: 0 });
    const err = (await c.sendStudents([{ external_student_id: 'a' }], 'r', 'k').catch((e) => e)) as LmsError;
    expect(err.code).toBe('LMS_UNREACHABLE');
    expect(JSON.stringify({ ...err, message: err.message, stack: err.stack })).not.toContain(KEY);
  });

  it('answers null for an unknown student and pages the reconciliation list', async () => {
    const { c, calls } = client([
      { status: 404, body: { error: { code: 'NOT_FOUND' } } },
      { status: 200, body: { items: [], page: 2, page_size: 200, total: 0 } },
    ]);
    await expect(c.getStudent('6f1c')).resolves.toBeNull();
    await c.listStudents('2026-11-21T07:00:00.000Z', 2, 200);
    expect(calls[1].url).toBe(
      'https://lms.example.test/tenant/v1/students?updated_since=2026-11-21T07%3A00%3A00.000Z&page=2&page_size=200',
    );
  });
});
