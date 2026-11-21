import { ALL_PERMISSIONS } from '../../../src/modules/roles-permissions';
import { LMS_READ_PERMISSIONS } from '../../../src/modules/lms-reads/lms-reads.constants';
import { LmsReadsService, toAppError, type LmsReadsSettings } from '../../../src/modules/lms-reads/lms-reads.service';
import { LmsReadError } from '../../../src/modules/lms-reads/tenant-read-client';
import { AppError } from '../../../src/shared/errors/app-error';

const KEY = 'unit-test-tenant-key-0123456789';
const on: LmsReadsSettings = { enabled: true, baseUrl: 'https://lms.example.test', apiKey: KEY, timeoutMs: 1000, cacheSeconds: 30 };

function service(settings: Partial<LmsReadsSettings>, handler: (url: string) => Response) {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(String(url));
    return handler(String(url));
  }) as unknown as typeof fetch;
  let s = { ...on, ...settings };
  return {
    svc: new LmsReadsService(() => s, fetchImpl),
    urls,
    set: (next: Partial<LmsReadsSettings>) => (s = { ...s, ...next }),
  };
}

const page = (items: unknown[]) => new Response(JSON.stringify({ items, page: 1, page_size: 10, total: items.length }), { status: 200 });

describe('lms-reads service', () => {
  it('guards every read with existing Panel permission codes (no new code, no migration)', () => {
    const known = new Set(ALL_PERMISSIONS.map((p) => p.code));
    for (const codes of Object.values(LMS_READ_PERMISSIONS)) for (const c of codes) expect(known.has(c)).toBe(true);
  });

  it('answers 404 LMS_READS_DISABLED and calls nothing while switched off', async () => {
    const { svc, urls } = service({ enabled: false }, () => page([]));
    await expect(svc.batches({ page: 1, limit: 10 })).rejects.toMatchObject({ statusCode: 404, code: 'LMS_READS_DISABLED' });
    expect(urls).toHaveLength(0);
    expect(svc.status()).toEqual({ enabled: false, configured: true, cacheSeconds: 30, timeoutMs: 1000 });
  });

  it('answers 503 LMS_NOT_CONFIGURED when on without URL or key', async () => {
    const { svc } = service({ apiKey: undefined }, () => page([]));
    await expect(svc.summary({})).rejects.toMatchObject({ statusCode: 503, code: 'LMS_NOT_CONFIGURED' });
    expect(svc.status().configured).toBe(false);
  });

  it('turns Panel list queries into LMS wire names and maps the page', async () => {
    const { svc, urls } = service({}, () => page([{ batch_code: 'B1', learners_enrolled: 3 }]));
    const r = await svc.batches({ page: 2, limit: 25, updatedSince: '2026-11-21T00:00:00Z', entityCode: 'E1' });
    expect(urls[0]).toBe(
      'https://lms.example.test/tenant/v1/batches?entity_code=E1&page=2&page_size=25&updated_since=2026-11-21T00%3A00%3A00Z',
    );
    expect(r.data[0]).toMatchObject({ code: 'B1', learnersEnrolled: 3 });
    expect(r.meta).toEqual({ page: 1, limit: 10, total: 1, totalPages: 1 });
    expect(r.cache).toBe('MISS');
  });

  it('passes attendance and live-session filters through', async () => {
    const { svc, urls } = service({}, () => new Response('{"items":[]}', { status: 200 }));
    await svc.attendance({ groupBy: 'batch', dateFrom: '2026-11-01', dateTo: '2026-11-21' });
    await svc.liveSessions({ date: '2026-11-21', deliveryMode: 'ONLINE', centreCode: 'C1' });
    expect(urls[0]).toBe('https://lms.example.test/tenant/v1/attendance?date_from=2026-11-01&date_to=2026-11-21&group_by=batch');
    expect(urls[1]).toBe('https://lms.example.test/tenant/v1/live-sessions?centre_code=C1&date=2026-11-21&delivery_mode=ONLINE');
  });

  it('rebuilds the client (and drops the cache) when the configuration changes', async () => {
    const { svc, urls, set } = service({}, () => page([]));
    await svc.centres({ page: 1, limit: 10 });
    await svc.centres({ page: 1, limit: 10 });
    expect(urls).toHaveLength(1);
    set({ baseUrl: 'https://lms2.example.test' });
    await svc.centres({ page: 1, limit: 10 });
    expect(urls[1]).toContain('https://lms2.example.test/tenant/v1/centres');
    svc.clearCache();
    await svc.centres({ page: 1, limit: 10 });
    expect(urls).toHaveLength(3);
  });

  it('maps client errors to Panel errors with codes only', async () => {
    const { svc } = service(
      {},
      () =>
        new Response(
          JSON.stringify({
            error: { code: 'FORBIDDEN', message: 'nope', details: [{ field: 'scope', code: 'missing_scope' }], request_id: 'rq-9' },
          }),
          {
            status: 403,
          },
        ),
    );
    const err = (await svc.trainers({ page: 1, limit: 10 }).catch((e: unknown) => e)) as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ statusCode: 503, code: 'LMS_KEY_REJECTED' });
    expect(err.details).toEqual([
      { field: 'scope', message: 'missing_scope' },
      { field: 'lmsCode', message: 'FORBIDDEN' },
      { field: 'lmsRequestId', message: 'rq-9' },
    ]);
    expect(JSON.stringify({ ...err, message: err.message })).not.toContain(KEY);
  });

  it.each([
    ['LMS_NOT_FOUND', 404],
    ['LMS_QUERY_REJECTED', 422],
    ['LMS_TIMEOUT', 503],
    ['LMS_UNREACHABLE', 503],
    ['LMS_UNAVAILABLE', 503],
    ['LMS_RATE_LIMITED', 503],
    ['LMS_BAD_ANSWER', 503],
  ] as const)('%s → HTTP %i', (code, status) => {
    expect(toAppError(new LmsReadError('x', code)).statusCode).toBe(status);
  });

  it('adds Retry-After seconds when the LMS gave one', () => {
    expect(toAppError(new LmsReadError('x', 'LMS_RATE_LIMITED', 429, 'RATE_LIMITED', [], undefined, 30)).details).toContainEqual({
      field: 'retryAfterSeconds',
      message: '30',
    });
  });
});
