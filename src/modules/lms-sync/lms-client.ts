import type { LmsStudentRecord } from './lms-payload';
import type { SyncErrorDetail } from './student-lms-link.entity';

/*
 * HTTP client of the LMS tenant API (/tenant/v1) for the student sync.
 *
 * - The tenant API key goes in the X-Api-Key header and nowhere else: it is never part of an error, a log line or a
 *   stored value. Errors carry the HTTP status, the LMS error code, field codes and the LMS request id only.
 * - Every call has a timeout (AbortController).
 * - Network errors, timeouts, 429 and 5xx are retried with exponential backoff and jitter, honouring Retry-After. A
 *   Retry-After longer than `maxRetryAfterMs` (e.g. the hourly intake quota) is not waited for: the call fails as
 *   retryable with `retryAfterMs`, and the worker defers the records until then.
 * - Other 4xx answers are never retried unchanged.
 */

export interface StudentSendAnswer {
  intake_request_id: string;
  accepted: number;
  rejected: { index: number; external_student_id: string | null; errors: { field?: string; code: string }[] }[];
}
export interface StudentStatusItem {
  external_student_id: string;
  status: string;
  reason_codes: string[];
  learner_code?: string | null;
  account_status?: string | null;
  updated_at?: string;
  /*
   * Request view only (lms-api since M2-F1): what that call did with the record — ACCEPTED / INVALID (written),
   * SKIPPED_UNCHANGED (same data, nothing written) or STALE (older copy, ignored) — and the learner it provisioned.
   * Absent from an older LMS.
   */
  outcome?: string;
  learner_id?: string | null;
}
export interface RequestStatusPage {
  intake_request_id: string;
  counts: Record<string, number>;
  items: StudentStatusItem[];
  page: number;
  page_size: number;
}
export interface StudentListPage {
  items: StudentStatusItem[];
  page: number;
  page_size: number;
  total: number;
}

export interface LmsClient {
  sendStudents(records: LmsStudentRecord[], requestId: string, idempotencyKey: string): Promise<StudentSendAnswer>;
  getRequest(intakeRequestId: string, page: number, pageSize: number): Promise<RequestStatusPage>;
  getStudent(externalStudentId: string): Promise<StudentStatusItem | null>;
  listStudents(updatedSince: string, page: number, pageSize: number): Promise<StudentListPage>;
}

export class LmsError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly status?: number,
    public readonly details: SyncErrorDetail[] = [],
    public readonly retryAfterMs?: number,
    public readonly lmsRequestId?: string,
  ) {
    super(message);
    this.name = 'LmsError';
  }
}

export interface LmsClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  /* Retries after the first try (so maxRetries + 1 tries at most). */
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /* Longest Retry-After waited for inside one call. */
  maxRetryAfterMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/*
 * Backoff before retry number `attempt` (0-based): exponential, capped, with "equal jitter" (half fixed, half random),
 * so concurrent clients spread out but the pause never collapses to zero.
 */
export function backoffDelay(attempt: number, baseMs: number, capMs: number, random: () => number = Math.random): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  const half = exp / 2;
  return Math.round(half + random() * half);
}

/* Retry-After as seconds ("120") or an HTTP date; undefined when absent or unreadable. */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/* The tenant base: the configured host plus /tenant/v1 (accepted with or without it, trailing slash or not). */
export const tenantBaseUrl = (baseUrl: string): string => `${baseUrl.replace(/\/+$/, '').replace(/\/tenant\/v1$/, '')}/tenant/v1`;

interface ErrorEnvelope {
  error?: { code?: string; details?: { field?: string; code?: string }[]; request_id?: string };
}

export function createLmsClient(opts: LmsClientOptions): LmsClient {
  const base = tenantBaseUrl(opts.baseUrl);
  const maxRetries = opts.maxRetries ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 2_000;
  const maxDelayMs = opts.maxDelayMs ?? 30_000;
  const maxRetryAfterMs = opts.maxRetryAfterMs ?? 60_000;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;

  async function once(method: 'GET' | 'POST', path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          'X-Api-Key': opts.apiKey,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...extraHeaders,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        redirect: 'error',
      });
      const raw = await res.text();
      let json: unknown = undefined;
      try {
        json = raw ? JSON.parse(raw) : undefined;
      } catch {
        json = undefined;
      }
      return { status: res.status, json, retryAfter: res.headers.get('retry-after') };
    } catch {
      const timedOut = controller.signal.aborted;
      /* Only the kind of failure is kept: a low-level error message could echo request details. */
      throw new LmsError(timedOut ? 'LMS call timed out' : 'LMS unreachable', timedOut ? 'LMS_TIMEOUT' : 'LMS_UNREACHABLE', true);
    } finally {
      clearTimeout(timer);
    }
  }

  async function call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
    allow404 = false,
  ): Promise<T | null> {
    for (let attempt = 0; ; attempt++) {
      let error: LmsError;
      try {
        const r = await once(method, path, body, headers);
        if (r.status >= 200 && r.status < 300) return (r.json ?? null) as T;
        if (allow404 && r.status === 404) return null;
        const env = (r.json ?? {}) as ErrorEnvelope;
        const code = env.error?.code ?? `HTTP_${r.status}`;
        const details: SyncErrorDetail[] = (env.error?.details ?? [])
          .filter((d) => d && typeof d.code === 'string')
          .map((d) => ({ ...(typeof d.field === 'string' ? { field: d.field } : {}), code: d.code! }));
        error = new LmsError(
          `LMS answered ${r.status} ${code}`,
          code,
          RETRYABLE_STATUS.has(r.status),
          r.status,
          details,
          parseRetryAfter(r.retryAfter),
          env.error?.request_id,
        );
      } catch (err) {
        if (!(err instanceof LmsError)) throw err;
        error = err;
      }
      if (!error.retryable || attempt >= maxRetries) throw error;
      if (error.retryAfterMs !== undefined && error.retryAfterMs > maxRetryAfterMs) throw error;
      await sleep(Math.max(error.retryAfterMs ?? 0, backoffDelay(attempt, baseDelayMs, maxDelayMs, random)));
    }
  }

  const enc = encodeURIComponent;
  return {
    async sendStudents(records, requestId, idempotencyKey) {
      const answer = await call<StudentSendAnswer>(
        'POST',
        '/students',
        { schema_version: 1, request_id: requestId, records },
        { 'Idempotency-Key': idempotencyKey },
      );
      if (!answer || typeof answer.intake_request_id !== 'string') throw new LmsError('LMS answer unreadable', 'LMS_BAD_ANSWER', true);
      return { ...answer, rejected: Array.isArray(answer.rejected) ? answer.rejected : [] };
    },
    async getRequest(id, page, pageSize) {
      const r = await call<RequestStatusPage>('GET', `/students/requests/${enc(id)}?page=${page}&page_size=${pageSize}`);
      return r ?? { intake_request_id: id, counts: {}, items: [], page, page_size: pageSize };
    },
    async getStudent(externalId) {
      return call<StudentStatusItem>('GET', `/students/${enc(externalId)}`, undefined, undefined, true);
    },
    async listStudents(updatedSince, page, pageSize) {
      const r = await call<StudentListPage>('GET', `/students?updated_since=${enc(updatedSince)}&page=${page}&page_size=${pageSize}`);
      return r ?? { items: [], page, page_size: pageSize, total: 0 };
    },
  };
}
