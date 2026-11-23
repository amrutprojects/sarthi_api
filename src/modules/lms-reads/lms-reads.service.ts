import { env } from '../../config/env.config';
import { HTTP_STATUS, type HttpStatus } from '../../constants/api-response.constants';
import { AppError, type ErrorDetail } from '../../shared/errors/app-error';
import type { PaginationMeta } from '../../utils/api-response';
import { LMS_READS_DISABLED, LMS_TENANT_READS } from './lms-reads.constants';
import {
  mapAttendance,
  mapBatch,
  mapCentre,
  mapDistrict,
  mapLiveSessions,
  mapSession,
  mapSummary,
  mapTrainer,
  mapTrack,
  readPage,
  toMeta,
  type LmsAttendance,
  type LmsBatch,
  type LmsCentre,
  type LmsDistrict,
  type LmsLiveSessions,
  type LmsSession,
  type LmsSummary,
  type LmsTrainer,
  type LmsTrack,
} from './lms-reads.mappers';
import type { LmsAttendanceQuery, LmsListQuery, LmsLiveSessionsQuery, LmsSummaryQuery } from './lms-reads.validation';
import { createTenantReadClient, LmsReadError, type LmsQuery, type TenantRead, type TenantReadClient } from './tenant-read-client';

/*
 * The Panel's LMS reads (M1): every answer comes from the LMS tenant API through the read client, mapped to the
 * Panel's shapes. Nothing is stored in the database. Behind LMS_READS_ENABLED: while it is off every data read
 * answers 404 LMS_READS_DISABLED and no call leaves the server.
 *
 * Settings are read from `env` on each request, so a test (or a later runtime switch) can change them; the client
 * (and its cache) is rebuilt only when the base URL, key, timeout or cache time changes.
 */
export interface LmsReadsSettings {
  enabled: boolean;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs: number;
  cacheSeconds: number;
}

export const settingsFromEnv = (): LmsReadsSettings => ({
  enabled: env.LMS_READS_ENABLED,
  baseUrl: env.LMS_EXTERNAL_BASE_URL,
  apiKey: env.LMS_TENANT_API_KEY,
  timeoutMs: env.LMS_READS_TIMEOUT_MS,
  cacheSeconds: env.LMS_READS_CACHE_SECONDS,
});

export interface LmsReadResult<T> {
  data: T;
  meta?: PaginationMeta;
  fetchedAt: Date;
  cache: TenantRead<unknown>['cache'];
}

export interface LmsReadsStatus {
  enabled: boolean;
  /* Base URL and key are both set (never says which values). */
  configured: boolean;
  cacheSeconds: number;
  timeoutMs: number;
}

/* Panel status for each client error: 404 and 422 mirror the LMS; anything else means "the LMS is not usable now". */
const PANEL_STATUS: Partial<Record<LmsReadError['code'], HttpStatus>> = {
  LMS_NOT_FOUND: HTTP_STATUS.NOT_FOUND,
  LMS_QUERY_REJECTED: HTTP_STATUS.UNPROCESSABLE_ENTITY,
};

/* A client error → the Panel's error envelope: codes only, never the key, the LMS URL or an LMS message. */
export function toAppError(err: LmsReadError): AppError {
  const details: ErrorDetail[] = err.details.map((d) => ({ ...(d.field ? { field: d.field } : {}), message: d.code }));
  if (err.lmsCode) details.push({ field: 'lmsCode', message: err.lmsCode });
  if (err.lmsRequestId) details.push({ field: 'lmsRequestId', message: err.lmsRequestId });
  if (err.retryAfterSeconds !== undefined) details.push({ field: 'retryAfterSeconds', message: String(err.retryAfterSeconds) });
  return new AppError(
    PANEL_STATUS[err.code] ?? HTTP_STATUS.SERVICE_UNAVAILABLE,
    err.message,
    err.code,
    details.length ? details : undefined,
  );
}

export class LmsReadsService {
  private current?: { key: string; client: TenantReadClient };

  constructor(
    private readonly settings: () => LmsReadsSettings = settingsFromEnv,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  status(): LmsReadsStatus {
    const s = this.settings();
    return { enabled: s.enabled, configured: !!(s.baseUrl && s.apiKey), cacheSeconds: s.cacheSeconds, timeoutMs: s.timeoutMs };
  }

  /* Drops every cached LMS answer. */
  clearCache(): void {
    this.current?.client.clear();
  }

  private client(): TenantReadClient {
    const s = this.settings();
    if (!s.enabled) throw new AppError(HTTP_STATUS.NOT_FOUND, 'LMS reads are switched off (LMS_READS_ENABLED)', LMS_READS_DISABLED);
    if (!s.baseUrl || !s.apiKey)
      throw new AppError(
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        'LMS reads are not configured (LMS_EXTERNAL_BASE_URL, LMS_TENANT_API_KEY)',
        'LMS_NOT_CONFIGURED',
      );
    /* In-memory identity of the configuration; never logged or returned. */
    const key = JSON.stringify([s.baseUrl, s.apiKey, s.timeoutMs, s.cacheSeconds]);
    if (this.current?.key !== key) {
      this.current = {
        key,
        client: createTenantReadClient({
          baseUrl: s.baseUrl,
          apiKey: s.apiKey,
          timeoutMs: s.timeoutMs,
          cacheTtlMs: s.cacheSeconds * 1000,
          fetchImpl: this.fetchImpl,
        }),
      };
    }
    return this.current.client;
  }

  private async read<T>(
    path: string,
    query: LmsQuery,
    map: (raw: unknown) => { data: T; meta?: PaginationMeta },
  ): Promise<LmsReadResult<T>> {
    const client = this.client();
    try {
      const r = await client.get<unknown>(path, query);
      return { ...map(r.data), fetchedAt: r.fetchedAt, cache: r.cache };
    } catch (err) {
      if (err instanceof LmsReadError) throw toAppError(err);
      throw err;
    }
  }

  private list<T>(path: string, q: LmsListQuery, mapItem: (raw: unknown) => T): Promise<LmsReadResult<T[]>> {
    return this.read(path, { page: q.page, page_size: q.limit, updated_since: q.updatedSince, entity_code: q.entityCode }, (raw) => {
      const page = readPage(raw);
      return { data: page.items.map(mapItem), meta: toMeta(page) };
    });
  }

  summary(q: LmsSummaryQuery): Promise<LmsReadResult<LmsSummary>> {
    return this.read(LMS_TENANT_READS.summary.path, { entity_code: q.entityCode }, (raw) => ({ data: mapSummary(raw) }));
  }

  centres(q: LmsListQuery): Promise<LmsReadResult<LmsCentre[]>> {
    return this.list(LMS_TENANT_READS.centres.path, q, mapCentre);
  }

  tracks(q: LmsListQuery): Promise<LmsReadResult<LmsTrack[]>> {
    return this.list(LMS_TENANT_READS.tracks.path, q, mapTrack);
  }

  districts(q: LmsListQuery): Promise<LmsReadResult<LmsDistrict[]>> {
    return this.list(LMS_TENANT_READS.districts.path, q, mapDistrict);
  }

  batches(q: LmsListQuery): Promise<LmsReadResult<LmsBatch[]>> {
    return this.list(LMS_TENANT_READS.batches.path, q, mapBatch);
  }

  sessions(q: LmsListQuery): Promise<LmsReadResult<LmsSession[]>> {
    return this.list(LMS_TENANT_READS.sessions.path, q, mapSession);
  }

  trainers(q: LmsListQuery): Promise<LmsReadResult<LmsTrainer[]>> {
    return this.list(LMS_TENANT_READS.trainers.path, q, mapTrainer);
  }

  liveSessions(q: LmsLiveSessionsQuery): Promise<LmsReadResult<LmsLiveSessions>> {
    return this.read(
      LMS_TENANT_READS.liveSessions.path,
      { date: q.date, centre_code: q.centreCode, batch_code: q.batchCode, delivery_mode: q.deliveryMode },
      (raw) => ({ data: mapLiveSessions(raw) }),
    );
  }

  attendance(q: LmsAttendanceQuery): Promise<LmsReadResult<LmsAttendance>> {
    return this.read(
      LMS_TENANT_READS.attendance.path,
      { group_by: q.groupBy, date_from: q.dateFrom, date_to: q.dateTo, entity_code: q.entityCode },
      (raw) => ({ data: mapAttendance(raw) }),
    );
  }
}

export const lmsReadsService = new LmsReadsService();
