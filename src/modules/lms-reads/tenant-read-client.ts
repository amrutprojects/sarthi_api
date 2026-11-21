/*
 * Read client of the LMS tenant API (/tenant/v1) for the Panel's LMS screens (M1 "Amrut reads its LMS data through
 * /tenant/v1"). GET only. The student sync's client (src/modules/lms-sync/lms-client.ts) is for the writes, with
 * retries and backoff; a screen read must fail fast and wants a cache, so this is a separate small client that reuses
 * the sync's tenantBaseUrl() and parseRetryAfter(), the same LMS_EXTERNAL_BASE_URL / LMS_TENANT_API_KEY config.
 *
 * - The tenant API key goes in the X-Api-Key header and nowhere else: never in a URL, an error, a log line or a cache
 *   key. Errors carry the kind of failure, the HTTP status, the LMS error code, field codes and the LMS request id.
 * - Every call has a timeout (AbortController). A Panel screen waits on it, so there is no retry loop: a failed read
 *   fails fast with a clear code (LMS_TIMEOUT, LMS_UNREACHABLE, LMS_UNAVAILABLE, LMS_KEY_REJECTED …).
 * - Short in-memory cache per path + query (cacheTtlMs; 0 = off). Concurrent identical reads share one call. When the
 *   LMS sends an ETag, a stale entry is revalidated with If-None-Match and a 304 renews it without a body. (The
 *   tenant API answers `Cache-Control: no-store` without an ETag today, so in practice the TTL alone applies; the
 *   revalidation starts working as soon as the LMS adds ETags, with no change here.)
 * - Error answers are never cached.
 */
import { parseRetryAfter, tenantBaseUrl } from '../lms-sync';

export type LmsReadErrorCode =
  | 'LMS_TIMEOUT'
  | 'LMS_UNREACHABLE'
  | 'LMS_UNAVAILABLE'
  | 'LMS_RATE_LIMITED'
  | 'LMS_KEY_REJECTED'
  | 'LMS_NOT_FOUND'
  | 'LMS_QUERY_REJECTED'
  | 'LMS_BAD_ANSWER'
  | 'LMS_ERROR';

export interface LmsReadErrorDetail {
  field?: string;
  code: string;
}

export class LmsReadError extends Error {
  constructor(
    message: string,
    public readonly code: LmsReadErrorCode,
    public readonly lmsStatus?: number,
    public readonly lmsCode?: string,
    public readonly details: LmsReadErrorDetail[] = [],
    public readonly lmsRequestId?: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'LmsReadError';
  }
}

export type LmsQuery = Record<string, string | number | undefined | null>;

export interface TenantRead<T> {
  data: T;
  /* When the LMS produced (or last revalidated) this answer. */
  fetchedAt: Date;
  /* HIT = served from the cache without a call; REVALIDATED = 304 on If-None-Match; MISS = a fresh body. */
  cache: 'HIT' | 'MISS' | 'REVALIDATED';
}

export interface TenantReadClient {
  get<T>(path: string, query?: LmsQuery): Promise<TenantRead<T>>;
  /* Drops every cached answer. */
  clear(): void;
}

export interface TenantReadClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  cacheTtlMs: number;
  /* Oldest entries are evicted beyond this many cached answers. */
  maxCacheEntries?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/* The tenant base URL and Retry-After parsing are the student sync's (one definition for both LMS clients). */
export { tenantBaseUrl };

/* Query string with keys in a stable order and empty values dropped, so equal reads share a cache entry. */
export function buildQuery(query: LmsQuery = {}): string {
  const parts = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/* Retry-After in whole seconds ("120" or an HTTP date); undefined when absent or unreadable. */
export function parseRetryAfterSeconds(value: string | null | undefined, now: number = Date.now()): number | undefined {
  const ms = parseRetryAfter(value, now);
  return ms === undefined ? undefined : Math.ceil(ms / 1000);
}

interface ErrorEnvelope {
  error?: { code?: unknown; details?: unknown; request_id?: unknown };
}

/* The LMS's error envelope reduced to codes: messages are dropped (they are for people and could echo input). */
function readEnvelope(json: unknown): { code?: string; details: LmsReadErrorDetail[]; requestId?: string } {
  const e = (json && typeof json === 'object' ? (json as ErrorEnvelope).error : undefined) ?? {};
  const details = (Array.isArray(e.details) ? e.details : [])
    .filter(
      (d): d is { field?: unknown; code: string } => !!d && typeof d === 'object' && typeof (d as { code?: unknown }).code === 'string',
    )
    .map((d) => ({ ...(typeof d.field === 'string' ? { field: d.field } : {}), code: d.code }));
  return {
    code: typeof e.code === 'string' ? e.code : undefined,
    details,
    requestId: typeof e.request_id === 'string' ? e.request_id : undefined,
  };
}

/* An LMS error answer → the client's error kinds. */
export function errorFromStatus(status: number, json: unknown, retryAfter?: string | null, now: number = Date.now()): LmsReadError {
  const env = readEnvelope(json);
  const lmsCode = env.code ?? `HTTP_${status}`;
  const make = (code: LmsReadErrorCode, message: string, retry?: number) =>
    new LmsReadError(message, code, status, lmsCode, env.details, env.requestId, retry);
  if (status === 401 || status === 403) return make('LMS_KEY_REJECTED', `The LMS refused the Amrut tenant key (${status} ${lmsCode})`);
  if (status === 404) return make('LMS_NOT_FOUND', `The LMS has no such read (404 ${lmsCode})`);
  if (status === 400 || status === 422) return make('LMS_QUERY_REJECTED', `The LMS refused the query (${status} ${lmsCode})`);
  if (status === 429)
    return make('LMS_RATE_LIMITED', 'The LMS is rate limiting the Amrut tenant key', parseRetryAfterSeconds(retryAfter, now));
  if (status >= 500)
    return make('LMS_UNAVAILABLE', `The LMS is unavailable (${status} ${lmsCode})`, parseRetryAfterSeconds(retryAfter, now));
  return make('LMS_ERROR', `The LMS answered ${status} ${lmsCode}`);
}

interface CacheEntry {
  data: unknown;
  etag?: string;
  fetchedAt: number;
  expiresAt: number;
}

export function createTenantReadClient(opts: TenantReadClientOptions): TenantReadClient {
  const base = tenantBaseUrl(opts.baseUrl);
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const maxEntries = opts.maxCacheEntries ?? 500;
  const cache = new Map<string, CacheEntry>();
  const inflight = new Map<string, Promise<TenantRead<unknown>>>();

  const remember = (key: string, entry: CacheEntry) => {
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value as string);
  };

  async function fetchOnce(key: string, stale: CacheEntry | undefined): Promise<TenantRead<unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    let res: Response;
    let raw: string;
    try {
      res = await doFetch(`${base}${key}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Api-Key': opts.apiKey,
          ...(stale?.etag ? { 'If-None-Match': stale.etag } : {}),
        },
        signal: controller.signal,
        redirect: 'error',
      });
      raw = await res.text();
    } catch {
      /* Only the kind of failure is kept: a low-level error message could echo request details. */
      if (controller.signal.aborted) throw new LmsReadError(`The LMS did not answer within ${opts.timeoutMs} ms`, 'LMS_TIMEOUT');
      throw new LmsReadError('The LMS could not be reached', 'LMS_UNREACHABLE');
    } finally {
      clearTimeout(timer);
    }

    const t = now();
    if (res.status === 304 && stale) {
      const renewed = { ...stale, fetchedAt: t, expiresAt: t + opts.cacheTtlMs };
      remember(key, renewed);
      return { data: renewed.data, fetchedAt: new Date(t), cache: 'REVALIDATED' };
    }

    let json: unknown;
    try {
      json = raw ? JSON.parse(raw) : undefined;
    } catch {
      json = undefined;
    }
    if (res.status < 200 || res.status >= 300) throw errorFromStatus(res.status, json, res.headers.get('retry-after'), t);
    if (!json || typeof json !== 'object') throw new LmsReadError('The LMS answer could not be read', 'LMS_BAD_ANSWER', res.status);

    const etag = res.headers.get('etag') ?? undefined;
    if (opts.cacheTtlMs > 0) remember(key, { data: json, etag, fetchedAt: t, expiresAt: t + opts.cacheTtlMs });
    return { data: json, fetchedAt: new Date(t), cache: 'MISS' };
  }

  return {
    async get<T>(path: string, query?: LmsQuery): Promise<TenantRead<T>> {
      const key = `${path.startsWith('/') ? path : `/${path}`}${buildQuery(query)}`;
      const entry = cache.get(key);
      if (entry && now() < entry.expiresAt) return { data: entry.data as T, fetchedAt: new Date(entry.fetchedAt), cache: 'HIT' };

      let pending = inflight.get(key);
      if (!pending) {
        pending = fetchOnce(key, entry?.etag ? entry : undefined).finally(() => inflight.delete(key));
        inflight.set(key, pending);
      }
      return (await pending) as TenantRead<T>;
    },
    clear() {
      cache.clear();
    },
  };
}
