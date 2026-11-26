import { signedHeaders } from './ipp-signature';

/*
 * Calls of Sarthi to IPP (contract ipp_backend/docs/SARTHI_LINK.md section 3). Every call is signed and has a time limit.
 * An error says only what kind of failure it was, the HTTP status and IPP's error code: never a form value, the secret, or
 * text IPP or the network sent along.
 */
export interface DecisionCall {
  id: string;
  application_id: string;
  action: string;
  from: string;
  to: string;
  reason: string | null;
  by: { name: string; role: string };
  at: string;
}

export type DecisionResult = { id: string; ok: true; duplicate: boolean } | { id: string; ok: false; code: string; stage: string | null };

export class IppError extends Error {
  constructor(
    message: string,
    /* HTTP status of IPP's answer; null = no (readable) answer. */
    public readonly status: number | null,
    public readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'IppError';
  }
  /* Tried again later (contract section 4): not reachable, 401, 408, 429, 5xx. Any other answer needs a person. */
  get retryable(): boolean {
    return this.status === null || this.status === 401 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

export interface IppDocument {
  contentType: string;
  /* null = IPP did not say. */
  contentLength: number | null;
  body: ReadableStream<Uint8Array>;
  /* Called for every piece passed on: the time limit starts again. */
  alive(): void;
  /* Ends the call (finished, refused, or the officer left). */
  close(): void;
}

export interface IppClient {
  sendDecisions(decisions: DecisionCall[]): Promise<DecisionResult[]>;
  ping(): Promise<void>;
  document(applicationId: string, code: string): Promise<IppDocument>;
}

export interface IppClientOptions {
  baseUrl: string;
  secret: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/* Codes and stages are upper-case words; anything else is not repeated. */
const word = (v: unknown): string | null => (typeof v === 'string' && /^[A-Z][A-Z0-9_]{1,59}$/.test(v) ? v : null);

interface Envelope {
  data?: unknown;
  error?: { code?: unknown } | null;
}

export function createIppClient(opts: IppClientOptions): IppClient {
  const doFetch = opts.fetchImpl ?? fetch;

  /* Sends one signed call; the time limit runs until the caller clears it. */
  async function start(method: 'GET' | 'POST', path: string, body?: string) {
    const url = new URL(`${opts.baseUrl}${path}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await doFetch(url, {
        method,
        headers: {
          ...signedHeaders(opts.secret, method, `${url.pathname}${url.search}`, body ?? ''),
          'Accept-Encoding': 'identity',
          ...(body !== undefined ? { 'Content-Type': 'application/json', Accept: 'application/json' } : {}),
        },
        body,
        signal: controller.signal,
        redirect: 'error',
      });
      return { res, controller, timer };
    } catch {
      clearTimeout(timer);
      /* Only the kind of failure is kept: a low-level message could repeat parts of the request. */
      throw new IppError(controller.signal.aborted ? 'IPP did not answer in time' : 'IPP is not reachable', null);
    }
  }

  function refused(status: number, json: Envelope | null): IppError {
    const code = word(json?.error?.code);
    return new IppError(`IPP answered ${status}${code ? ` ${code}` : ''}`, status, code);
  }

  async function readJson(res: Response, timedOut: () => boolean): Promise<Envelope | null> {
    let raw: string;
    try {
      raw = await res.text();
    } catch {
      throw new IppError(timedOut() ? 'IPP did not answer in time' : 'IPP is not reachable', null);
    }
    try {
      const json: unknown = JSON.parse(raw);
      return json && typeof json === 'object' ? (json as Envelope) : null;
    } catch {
      return null;
    }
  }

  async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Envelope> {
    const { res, controller, timer } = await start(method, path, body === undefined ? undefined : JSON.stringify(body));
    try {
      const json = await readJson(res, () => controller.signal.aborted);
      if (!res.ok) throw refused(res.status, json);
      if (!json) throw new IppError('The answer of IPP could not be read', null);
      return json;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async sendDecisions(decisions) {
      const { data } = await call('POST', '/link/decisions', { decisions });
      const results = (data as { results?: unknown } | null | undefined)?.results;
      if (!Array.isArray(results)) throw new IppError('The answer of IPP could not be read', null);
      return results
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string')
        .filter((r) => typeof r.ok === 'boolean')
        .map((r) =>
          r.ok
            ? { id: String(r.id), ok: true as const, duplicate: r.duplicate === true }
            : { id: String(r.id), ok: false as const, code: word(r.code) ?? 'REFUSED', stage: word(r.stage) },
        );
    },

    async ping() {
      await call('GET', '/link/ping');
    },

    async document(applicationId, code) {
      const { res, controller, timer } = await start(
        'GET',
        `/link/applications/${encodeURIComponent(applicationId)}/documents/${encodeURIComponent(code)}`,
      );
      const close = () => {
        clearTimeout(timer);
        controller.abort();
      };
      if (!res.ok || !res.body) {
        try {
          const json = res.ok ? null : await readJson(res, () => controller.signal.aborted);
          throw res.ok ? new IppError('The answer of IPP could not be read', null) : refused(res.status, json);
        } finally {
          close();
        }
      }
      const length = res.headers.get('content-encoding') ? null : res.headers.get('content-length');
      return {
        contentType: (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase(),
        contentLength: length !== null && /^\d{1,15}$/.test(length) ? Number(length) : null,
        body: res.body,
        alive: () => void timer.refresh(),
        close,
      };
    },
  };
}
