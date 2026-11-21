import {
  buildQuery,
  createTenantReadClient,
  errorFromStatus,
  LmsReadError,
  parseRetryAfterSeconds,
  tenantBaseUrl,
} from '../../../src/modules/lms-reads/tenant-read-client';

const KEY = 'unit-test-tenant-key-0123456789';

interface Call {
  url: string;
  headers: Record<string, string>;
}

/* A fetch double: answers from a queue of handlers and records every call. */
function fakeFetch(...answers: ((call: Call, init: RequestInit) => Response | Promise<Response>)[]) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const call = { url: String(url), headers: { ...(init.headers as Record<string, string>) } };
    calls.push(call);
    const next = answers.length > 1 ? answers.shift()! : answers[0];
    return next(call, init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function client(fetchImpl: typeof fetch, opts: { ttl?: number; now?: () => number; timeoutMs?: number } = {}) {
  return createTenantReadClient({
    baseUrl: 'https://lms.example.test/',
    apiKey: KEY,
    timeoutMs: opts.timeoutMs ?? 1000,
    cacheTtlMs: opts.ttl ?? 30_000,
    fetchImpl,
    now: opts.now,
  });
}

describe('tenant read client — helpers', () => {
  it('builds the /tenant/v1 base with or without the suffix', () => {
    expect(tenantBaseUrl('https://lms.example.test')).toBe('https://lms.example.test/tenant/v1');
    expect(tenantBaseUrl('https://lms.example.test/tenant/v1/')).toBe('https://lms.example.test/tenant/v1');
  });

  it('builds a stable query string without empty values', () => {
    expect(buildQuery({ page_size: 10, page: 2, entity_code: undefined, x: '', y: null })).toBe('?page=2&page_size=10');
    expect(buildQuery({ updated_since: '2026-11-21T00:00:00+05:30' })).toBe('?updated_since=2026-11-21T00%3A00%3A00%2B05%3A30');
    expect(buildQuery({})).toBe('');
  });

  it('reads Retry-After as seconds or a date', () => {
    expect(parseRetryAfterSeconds('120')).toBe(120);
    expect(parseRetryAfterSeconds(new Date(10_000).toUTCString(), 0)).toBe(10);
    expect(parseRetryAfterSeconds('soon')).toBeUndefined();
    expect(parseRetryAfterSeconds(null)).toBeUndefined();
  });

  it.each([
    [401, 'LMS_KEY_REJECTED'],
    [403, 'LMS_KEY_REJECTED'],
    [404, 'LMS_NOT_FOUND'],
    [400, 'LMS_QUERY_REJECTED'],
    [422, 'LMS_QUERY_REJECTED'],
    [429, 'LMS_RATE_LIMITED'],
    [500, 'LMS_UNAVAILABLE'],
    [503, 'LMS_UNAVAILABLE'],
    [418, 'LMS_ERROR'],
  ])('maps LMS %i to %s', (status, code) => {
    expect(errorFromStatus(status, {}).code).toBe(code);
  });

  it('keeps the LMS codes and request id, never the LMS message', () => {
    const e = errorFromStatus(
      403,
      {
        error: {
          code: 'FORBIDDEN',
          message: 'secret text',
          details: [{ field: 'scope', code: 'missing_scope' }, { bad: 1 }],
          request_id: 'rq-1',
        },
      },
      null,
    );
    expect(e).toMatchObject({ code: 'LMS_KEY_REJECTED', lmsStatus: 403, lmsCode: 'FORBIDDEN', lmsRequestId: 'rq-1' });
    expect(e.details).toEqual([{ field: 'scope', code: 'missing_scope' }]);
    expect(e.message).not.toContain('secret text');
  });

  it('reads Retry-After on 429 and 503', () => {
    expect(errorFromStatus(429, {}, '30').retryAfterSeconds).toBe(30);
    expect(errorFromStatus(503, {}, '5').retryAfterSeconds).toBe(5);
  });
});

describe('tenant read client — calls', () => {
  it('sends the key in X-Api-Key only, GET, to the tenant base with the query', async () => {
    const f = fakeFetch(() => json({ items: [] }));
    await client(f.impl).get('/batches', { page: 1, page_size: 10 });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe('https://lms.example.test/tenant/v1/batches?page=1&page_size=10');
    expect(f.calls[0].url).not.toContain(KEY);
    expect(f.calls[0].headers['X-Api-Key']).toBe(KEY);
    expect(f.calls[0].headers['If-None-Match']).toBeUndefined();
  });

  it('serves a repeat read from the cache within the TTL, then asks again', async () => {
    let t = 1_000;
    const f = fakeFetch(
      () => json({ n: 1 }),
      () => json({ n: 2 }),
    );
    const c = client(f.impl, { ttl: 30_000, now: () => t });
    expect(await c.get('/summary')).toMatchObject({ data: { n: 1 }, cache: 'MISS' });
    t += 29_000;
    expect(await c.get('/summary')).toMatchObject({ data: { n: 1 }, cache: 'HIT' });
    t += 2_000;
    expect(await c.get('/summary')).toMatchObject({ data: { n: 2 }, cache: 'MISS' });
    expect(f.calls).toHaveLength(2);
  });

  it('keys the cache on path and query (order-independent)', async () => {
    const f = fakeFetch(() => json({ ok: true }));
    const c = client(f.impl);
    await c.get('/batches', { page: 1, page_size: 10 });
    await c.get('/batches', { page_size: 10, page: 1 });
    await c.get('/batches', { page: 2, page_size: 10 });
    expect(f.calls).toHaveLength(2);
  });

  it('does not cache with a TTL of 0', async () => {
    const f = fakeFetch(() => json({ ok: true }));
    const c = client(f.impl, { ttl: 0 });
    await c.get('/summary');
    await c.get('/summary');
    expect(f.calls).toHaveLength(2);
  });

  it('revalidates a stale entry with If-None-Match and renews it on 304', async () => {
    let t = 0;
    const f = fakeFetch(
      () => json({ v: 'first' }, 200, { ETag: 'W/"abc"' }),
      () => new Response(null, { status: 304, headers: { ETag: 'W/"abc"' } }),
    );
    const c = client(f.impl, { ttl: 1_000, now: () => t });
    await c.get('/centres');
    t = 5_000;
    const again = await c.get('/centres');
    expect(f.calls[1].headers['If-None-Match']).toBe('W/"abc"');
    expect(again).toMatchObject({ data: { v: 'first' }, cache: 'REVALIDATED' });
    expect(again.fetchedAt.getTime()).toBe(5_000);
    t = 5_500;
    expect(await c.get('/centres')).toMatchObject({ cache: 'HIT' });
    expect(f.calls).toHaveLength(2);
  });

  it('shares one call between concurrent identical reads', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const f = fakeFetch(async () => {
      await gate;
      return json({ ok: 1 });
    });
    const c = client(f.impl);
    const both = Promise.all([c.get('/trainers'), c.get('/trainers')]);
    release();
    const [a, b] = await both;
    expect(a.data).toEqual({ ok: 1 });
    expect(b.data).toEqual({ ok: 1 });
    expect(f.calls).toHaveLength(1);
  });

  it('never caches an error answer', async () => {
    const f = fakeFetch(
      () => json({ error: { code: 'SERVICE_UNAVAILABLE' } }, 503),
      () => json({ ok: true }),
    );
    const c = client(f.impl);
    await expect(c.get('/summary')).rejects.toMatchObject({ code: 'LMS_UNAVAILABLE', lmsStatus: 503 });
    await expect(c.get('/summary')).resolves.toMatchObject({ data: { ok: true } });
  });

  it('times out with LMS_TIMEOUT', async () => {
    const f = fakeFetch(
      (_call, init) => new Promise<Response>((_res, rej) => init.signal!.addEventListener('abort', () => rej(new Error(`aborted ${KEY}`)))),
    );
    const err = await client(f.impl, { timeoutMs: 20 })
      .get('/summary')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LmsReadError);
    expect(err).toMatchObject({ code: 'LMS_TIMEOUT' });
    expect((err as Error).message).not.toContain(KEY);
  });

  it('reports a network failure as LMS_UNREACHABLE without the low-level message', async () => {
    const f = fakeFetch(() => {
      throw new Error(`ECONNREFUSED https://lms.example.test?k=${KEY}`);
    });
    const err = (await client(f.impl)
      .get('/summary')
      .catch((e: unknown) => e)) as LmsReadError;
    expect(err.code).toBe('LMS_UNREACHABLE');
    expect(JSON.stringify({ ...err, message: err.message })).not.toContain(KEY);
  });

  it('refuses an unreadable body with LMS_BAD_ANSWER', async () => {
    const f = fakeFetch(() => new Response('<html>proxy</html>', { status: 200 }));
    await expect(client(f.impl).get('/summary')).rejects.toMatchObject({ code: 'LMS_BAD_ANSWER' });
  });

  it('clear() drops cached answers', async () => {
    const f = fakeFetch(() => json({ ok: true }));
    const c = client(f.impl);
    await c.get('/summary');
    c.clear();
    await c.get('/summary');
    expect(f.calls).toHaveLength(2);
  });
});
