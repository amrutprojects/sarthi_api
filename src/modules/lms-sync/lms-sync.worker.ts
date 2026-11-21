import crypto from 'crypto';
import type { DataSource } from 'typeorm';
import { ELIGIBLE_STUDENT_SQL, SYNC_ERROR, flagForLmsStatus, reconcileCursorKey } from './lms-sync.constants';
import { LmsError, backoffDelay, type LmsClient, type StudentStatusItem } from './lms-client';
import {
  buildLmsRecord,
  idempotencyKeyFor,
  missingRequiredFields,
  recordChecksum,
  type LmsStudentRecord,
  type StudentSyncRow,
} from './lms-payload';
import type { SyncErrorDetail } from './student-lms-link.entity';

/*
 * The Amrut → LMS student sync worker (M1). One cycle:
 *   1. pending links of students that are no longer eligible → FAILED (NOT_ELIGIBLE);
 *   2. send: eligible students (status RECEIVED, active, not deleted) with no link yet, with a due PENDING link
 *      (manual push, retry, LMS was down), or edited since they were last evaluated (students.updatedAt, kept
 *      current by a trigger) whose payload checksum changed → POST /tenant/v1/students in batches;
 *   3. follow: SENT links → GET /tenant/v1/students/requests/{id} (and the student for its learner code);
 *   4. reconcile: GET /tenant/v1/students?updated_since=<cursor>.
 * The worker only reads the students table; it never writes to it. A PostgreSQL advisory lock keeps one cycle at a
 * time across API instances. When the LMS is down (network, timeout, 429, 5xx) the records stay PENDING with a
 * backoff and the cycle stops; the next cycle picks them up again.
 */

export interface SyncLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface LmsSyncWorkerOptions {
  ds: DataSource;
  /* null = sync disabled (no call to the LMS). */
  client: LmsClient | null;
  tenantCode: string;
  batchSize: number;
  maxBatchesPerCycle?: number;
  followRequestsPerCycle?: number;
  /* A SENT link's request is checked again only after this many seconds. */
  followMinAgeSeconds?: number;
  learnerLookupsPerCycle?: number;
  reconcilePagesPerCycle?: number;
  /* Deferral of PENDING records after the LMS was unavailable: exponential from base to cap, with jitter. */
  deferBaseMs?: number;
  deferCapMs?: number;
  log?: SyncLogger;
}

export interface SyncCycleStats {
  ran: boolean;
  reason?: 'disabled' | 'locked';
  sent: number;
  rejected: number;
  failed: number;
  deferred: number;
  unchanged: number;
  missingFields: number;
  notEligible: number;
  followed: number;
  reconciled: number;
  lmsUnavailable: boolean;
  errorCode?: string;
}

/* Arbitrary constant key of the cycle's advisory lock. */
const LOCK_KEY = 727_274_001;
const PAGE_SIZE = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/* Local error codes that a status read from the LMS must not overwrite. */
const LOCAL_ERRORS = [SYNC_ERROR.MISSING_REQUIRED_FIELDS, SYNC_ERROR.NOT_ELIGIBLE];

interface CandidateRow extends StudentSyncRow {
  studentUpdatedAt: Date;
  /* The same instant as text, full microsecond precision (a JS Date keeps milliseconds only). */
  studentUpdatedAtExact: string;
  linkId: string | null;
  linkStatus: string | null;
  linkChecksum: string | null;
  linkSourceUpdatedAtSent: Date | null;
  linkAttempts: number | null;
}

/* The student columns the payload is built from (shared with the admin detail view). */
export const STUDENT_SYNC_COLUMNS = `
  s."id", s."code", s."firstName", s."lastName", s."fatherName", s."motherName", s."email",
  to_char(s."dateOfBirth", 'YYYY-MM-DD') AS "dateOfBirth", s."gender", s."maritalStatus", s."permanentAddress", s."landmark",
  COALESCE(NULLIF(btrim(s."districtName"), ''), d."name") AS "districtName",
  COALESCE(NULLIF(btrim(s."talukaName"), ''), t."name") AS "talukaName",
  s."division", s."pinCode", s."mobile", s."alternateMobile", s."alternateEmail", s."centreCode", s."trackCode",
  s."trackSourceValue", s."educationQualification", s."qualificationName", s."qualificationStream", s."qualificationBoard",
  to_char(s."qualificationCompletedOn", 'YYYY-MM-DD') AS "qualificationCompletedOn", s."score"::text AS "score",
  s."gradingType", s."qualificationClass", s."externalStatus", s."approvedAt", s."schemeName", s."sourceSubmittedAt",
  s."evidenceRef", s."declarationAccepted", s."documents"`;
export const STUDENT_SYNC_JOINS = `
  LEFT JOIN "districts" d ON d."id" = s."districtId"
  LEFT JOIN "talukas" t ON t."id" = s."talukaId"`;

export interface LmsSyncWorker {
  readonly enabled: boolean;
  readonly tenantCode: string;
  runCycle(): Promise<SyncCycleStats>;
}

export function createLmsSyncWorker(o: LmsSyncWorkerOptions): LmsSyncWorker {
  const ds = o.ds;
  const tenant = o.tenantCode;
  const maxBatches = o.maxBatchesPerCycle ?? 20;
  const followRequests = o.followRequestsPerCycle ?? 20;
  const followMinAge = o.followMinAgeSeconds ?? 30;
  const learnerLookups = o.learnerLookupsPerCycle ?? 50;
  const reconcilePages = o.reconcilePagesPerCycle ?? 25;
  const deferBase = o.deferBaseMs ?? 30_000;
  const deferCap = o.deferCapMs ?? 30 * 60_000;
  const log: SyncLogger = o.log ?? { info: () => undefined, warn: () => undefined, error: () => undefined };

  const emptyStats = (): SyncCycleStats => ({
    ran: true,
    sent: 0,
    rejected: 0,
    failed: 0,
    deferred: 0,
    unchanged: 0,
    missingFields: 0,
    notEligible: 0,
    followed: 0,
    reconciled: 0,
    lmsUnavailable: false,
  });

  /* Only the error's code, status and the LMS request id are ever logged (never headers or the key). */
  const errInfo = (e: LmsError) => ({ code: e.code, status: e.status, lmsRequestId: e.lmsRequestId });

  async function ensureLinks(studentIds: string[]): Promise<void> {
    if (!studentIds.length) return;
    await ds.query(
      `INSERT INTO "student_lms_link" ("studentId", "lmsTenantCode", "syncStatus", "queuedAt")
       SELECT unnest($2::uuid[]), $1, 'PENDING', now()
       ON CONFLICT ("studentId", "lmsTenantCode") DO NOTHING`,
      [tenant, studentIds],
    );
  }

  async function markNotEligible(): Promise<number> {
    const r: [unknown[], number] = await ds.query(
      `UPDATE "student_lms_link" l
          SET "syncStatus" = 'FAILED', "lastErrorCode" = $2, "lastErrorDetails" = '[]'::jsonb, "nextAttemptAt" = NULL
         FROM "students" s
        WHERE s."id" = l."studentId" AND l."lmsTenantCode" = $1 AND l."syncStatus" = 'PENDING' AND NOT (${ELIGIBLE_STUDENT_SQL})`,
      [tenant, SYNC_ERROR.NOT_ELIGIBLE],
    );
    return r[1] ?? 0;
  }

  async function candidates(limit: number): Promise<CandidateRow[]> {
    return ds.query(
      `SELECT ${STUDENT_SYNC_COLUMNS}, s."updatedAt" AS "studentUpdatedAt", s."updatedAt"::text AS "studentUpdatedAtExact",
              l."id" AS "linkId", l."syncStatus" AS "linkStatus", l."payloadChecksum" AS "linkChecksum",
              l."sourceUpdatedAtSent" AS "linkSourceUpdatedAtSent", l."attempts" AS "linkAttempts"
         FROM "students" s
         ${STUDENT_SYNC_JOINS}
         LEFT JOIN "student_lms_link" l ON l."studentId" = s."id" AND l."lmsTenantCode" = $1
        WHERE ${ELIGIBLE_STUDENT_SQL}
          AND (
               l."id" IS NULL
            OR (l."syncStatus" = 'PENDING' AND (l."nextAttemptAt" IS NULL OR l."nextAttemptAt" <= now()))
            OR (l."syncStatus" <> 'PENDING' AND (l."studentUpdatedAt" IS NULL OR s."updatedAt" > l."studentUpdatedAt"))
          )
        ORDER BY COALESCE(l."queuedAt", s."updatedAt"), s."id"
        LIMIT $2`,
      [tenant, limit],
    );
  }

  /* One send step over at most batchSize candidates. Returns false when the cycle must stop sending. */
  async function sendBatch(stats: SyncCycleStats): Promise<{ more: boolean }> {
    const rows = await candidates(o.batchSize);
    if (!rows.length) return { more: false };
    await ensureLinks(rows.map((r) => r.id));

    interface Outgoing {
      row: CandidateRow;
      record: LmsStudentRecord;
      checksum: string;
      sourceUpdatedAt: Date;
      attempts: number;
    }
    const outgoing: Outgoing[] = [];
    for (const row of rows) {
      const record = buildLmsRecord(row);
      const checksum = recordChecksum(record);
      const missing = missingRequiredFields(record);
      if (missing.length) {
        stats.missingFields++;
        await ds.query(
          `UPDATE "student_lms_link"
              SET "syncStatus" = 'FAILED', "lastErrorCode" = $3, "lastErrorDetails" = $4::jsonb, "nextAttemptAt" = NULL,
                  "studentUpdatedAt" = $5
            WHERE "studentId" = $1 AND "lmsTenantCode" = $2`,
          [
            row.id,
            tenant,
            SYNC_ERROR.MISSING_REQUIRED_FIELDS,
            JSON.stringify(missing.map((field) => ({ field, code: 'required' }))),
            row.studentUpdatedAtExact,
          ],
        );
        continue;
      }
      if (row.linkStatus && row.linkStatus !== 'PENDING' && row.linkChecksum === checksum) {
        /* Touched but not changed (or changed only in fields the sync does not send): nothing to send. */
        stats.unchanged++;
        await ds.query(`UPDATE "student_lms_link" SET "studentUpdatedAt" = $3 WHERE "studentId" = $1 AND "lmsTenantCode" = $2`, [
          row.id,
          tenant,
          row.studentUpdatedAtExact,
        ]);
        continue;
      }
      /*
       * source_updated_at: students.updatedAt, but always newer than the value the LMS already holds. So a forced
       * re-send of unchanged data (Push, Retry after a rejection) is a new body with a new Idempotency-Key: the LMS
       * skips it as unchanged when it was accepted, or processes it again when it was invalid — never a replay of an
       * old rejection. Retries of a send that never reached the LMS keep the same body and key (safe replay).
       */
      const updatedAt = new Date(row.studentUpdatedAt);
      const sentBefore = row.linkSourceUpdatedAtSent ? new Date(row.linkSourceUpdatedAtSent) : null;
      const sourceUpdatedAt = sentBefore && updatedAt <= sentBefore ? new Date(Math.max(Date.now(), sentBefore.getTime() + 1)) : updatedAt;
      /* Tries of the current change: a queued (PENDING) or unchanged record continues its count, a new change starts at 1. */
      const attempts = (row.linkStatus === 'PENDING' || row.linkChecksum === checksum ? (row.linkAttempts ?? 0) : 0) + 1;
      outgoing.push({ row, record: { ...record, source_updated_at: sourceUpdatedAt.toISOString() }, checksum, sourceUpdatedAt, attempts });
    }
    if (!outgoing.length) return { more: true };

    const records = outgoing.map((x) => x.record);
    const idempotencyKey = idempotencyKeyFor(records);
    const requestId = `amrut-sync-${crypto.randomUUID()}`;
    try {
      const answer = await o.client!.sendStudents(records, requestId, idempotencyKey);
      const rejectedByIndex = new Map(answer.rejected.map((r) => [r.index, r]));
      await ds.transaction(async (m) => {
        for (const [i, x] of outgoing.entries()) {
          const rej = rejectedByIndex.get(i);
          const details: SyncErrorDetail[] = rej
            ? rej.errors.map((e) => ({ ...(typeof e.field === 'string' ? { field: e.field } : {}), code: String(e.code) }))
            : [];
          await m.query(
            `UPDATE "student_lms_link"
                SET "syncStatus" = $3, "lmsRequestId" = $4, "payloadChecksum" = $5, "studentUpdatedAt" = $6,
                    "sourceUpdatedAtSent" = $7, "attempts" = $8, "lastErrorCode" = $9, "lastErrorDetails" = $10::jsonb,
                    "nextAttemptAt" = NULL, "lastSentAt" = now(), "lastCheckedAt" = NULL
              WHERE "studentId" = $1 AND "lmsTenantCode" = $2`,
            [
              x.row.id,
              tenant,
              rej ? 'FAILED' : 'SENT',
              answer.intake_request_id,
              x.checksum,
              x.row.studentUpdatedAtExact,
              x.sourceUpdatedAt,
              x.attempts,
              rej ? SYNC_ERROR.LMS_REJECTED_FIELDS : null,
              JSON.stringify(details),
            ],
          );
        }
      });
      stats.rejected += answer.rejected.length;
      stats.sent += outgoing.length - answer.rejected.length;
      log.info(
        { records: outgoing.length, rejected: answer.rejected.length, lmsRequestId: answer.intake_request_id },
        'lms sync: batch sent',
      );
      return { more: true };
    } catch (err) {
      if (!(err instanceof LmsError)) throw err;
      /* 401/403: the key or its scopes (configuration). Kept queued like an outage, so fixing the key recovers. */
      const keepQueued = err.retryable || err.status === 401 || err.status === 403;
      await ds.transaction(async (m) => {
        for (const x of outgoing) {
          if (keepQueued) {
            const deferMs = Math.max(err.retryAfterMs ?? 0, backoffDelay(x.attempts - 1, deferBase, deferCap));
            await m.query(
              `UPDATE "student_lms_link"
                  SET "syncStatus" = 'PENDING', "attempts" = $3, "lastErrorCode" = $4, "lastErrorDetails" = $5::jsonb,
                      "nextAttemptAt" = now() + make_interval(secs => $6::double precision), "queuedAt" = COALESCE("queuedAt", now())
                WHERE "studentId" = $1 AND "lmsTenantCode" = $2`,
              [x.row.id, tenant, x.attempts, err.code, JSON.stringify(err.details), deferMs / 1000],
            );
          } else {
            await m.query(
              `UPDATE "student_lms_link"
                  SET "syncStatus" = 'FAILED', "attempts" = $3, "lastErrorCode" = $4, "lastErrorDetails" = $5::jsonb,
                      "nextAttemptAt" = NULL, "studentUpdatedAt" = $6
                WHERE "studentId" = $1 AND "lmsTenantCode" = $2`,
              [x.row.id, tenant, x.attempts, err.code, JSON.stringify(err.details), x.row.studentUpdatedAtExact],
            );
          }
        }
      });
      stats.errorCode = err.code;
      if (keepQueued) {
        stats.deferred += outgoing.length;
        stats.lmsUnavailable = true;
        log.warn({ ...errInfo(err), records: outgoing.length }, 'lms sync: LMS unavailable, records stay queued');
      } else {
        stats.failed += outgoing.length;
        log.error({ ...errInfo(err), records: outgoing.length }, 'lms sync: batch refused by the LMS');
      }
      return { more: false };
    }
  }

  /* Applies one LMS status to the student's link (by external_student_id = students.id). */
  async function applyStatus(item: StudentStatusItem, onlyRequestId?: string): Promise<boolean> {
    if (!item || typeof item.external_student_id !== 'string' || !UUID_RE.test(item.external_student_id)) return false;
    const flag = flagForLmsStatus(item.status);
    const reasons = Array.isArray(item.reason_codes) ? item.reason_codes.map(String) : [];
    const errorCode = flag === 'FAILED' ? `LMS_${item.status}` : flag === 'REVIEW' ? 'LMS_DUPLICATE_SUSPECT' : null;
    const details = flag === 'FAILED' || flag === 'REVIEW' ? reasons.map((code) => ({ code })) : [];
    const r: [unknown[], number] = await ds.query(
      `UPDATE "student_lms_link"
          SET "lmsStatus" = $3, "lmsReasonCodes" = $4::jsonb,
              "lmsLearnerCode" = COALESCE($5, "lmsLearnerCode"), "lastCheckedAt" = now(),
              "syncStatus" = CASE WHEN "syncStatus" = 'PENDING' OR COALESCE("lastErrorCode", '') = ANY($9) THEN "syncStatus" ELSE $6 END,
              "lastSyncedAt" = CASE WHEN $6 = 'SYNCED' AND "syncStatus" <> 'PENDING' AND COALESCE("lastErrorCode", '') <> ALL($9)
                                    THEN now() ELSE "lastSyncedAt" END,
              "lastErrorCode" = CASE WHEN "syncStatus" = 'PENDING' OR COALESCE("lastErrorCode", '') = ANY($9) THEN "lastErrorCode" ELSE $7 END,
              "lastErrorDetails" = CASE WHEN "syncStatus" = 'PENDING' OR COALESCE("lastErrorCode", '') = ANY($9) THEN "lastErrorDetails"
                                        ELSE $8::jsonb END
        WHERE "studentId" = $1 AND "lmsTenantCode" = $2 ${onlyRequestId ? 'AND "lmsRequestId" = $10' : ''}`,
      [
        item.external_student_id,
        tenant,
        String(item.status).slice(0, 30),
        JSON.stringify(reasons),
        item.learner_code ?? null,
        flag,
        errorCode,
        JSON.stringify(details),
        /* INVALID is the LMS's view of a record it rejected: keep the field codes the send answer gave. */
        item.status === 'INVALID' ? [...LOCAL_ERRORS, SYNC_ERROR.LMS_REJECTED_FIELDS] : LOCAL_ERRORS,
        ...(onlyRequestId ? [onlyRequestId] : []),
      ],
    );
    return (r[1] ?? 0) > 0;
  }

  async function follow(stats: SyncCycleStats): Promise<void> {
    const requests: { lmsRequestId: string }[] = await ds.query(
      `SELECT DISTINCT "lmsRequestId" FROM "student_lms_link"
        WHERE "lmsTenantCode" = $1 AND "syncStatus" = 'SENT' AND "lmsRequestId" IS NOT NULL
          AND ("lastCheckedAt" IS NULL OR "lastCheckedAt" <= now() - make_interval(secs => $2::double precision))
        LIMIT $3`,
      [tenant, followMinAge, followRequests],
    );
    let lookups = 0;
    for (const { lmsRequestId } of requests) {
      for (let page = 1; ; page++) {
        const res = await o.client!.getRequest(lmsRequestId, page, PAGE_SIZE);
        for (const item of res.items ?? []) {
          let it = item;
          /* The request view has no learner code: read the student once it is provisioned. */
          if (item.status === 'PROVISIONED' && !item.learner_code && lookups < learnerLookups) {
            lookups++;
            it = (await o.client!.getStudent(item.external_student_id)) ?? item;
          }
          if (await applyStatus(it, lmsRequestId)) stats.followed++;
        }
        if (!res.items || res.items.length < PAGE_SIZE) break;
      }
      await ds.query(
        `UPDATE "student_lms_link" SET "lastCheckedAt" = now() WHERE "lmsTenantCode" = $1 AND "lmsRequestId" = $2 AND "syncStatus" = 'SENT'`,
        [tenant, lmsRequestId],
      );
    }
  }

  async function reconcile(stats: SyncCycleStats): Promise<void> {
    const key = reconcileCursorKey(tenant);
    const [state] = (await ds.query(`SELECT "value" FROM "lms_sync_state" WHERE "key" = $1`, [key])) as { value: string }[];
    let cursor = state?.value;
    if (!cursor) {
      const [first] = (await ds.query(`SELECT min("lastSentAt") AS "at" FROM "student_lms_link" WHERE "lmsTenantCode" = $1`, [tenant])) as {
        at: Date | null;
      }[];
      if (!first?.at) return;
      cursor = new Date(new Date(first.at).getTime() - 5 * 60_000).toISOString();
    }
    let max: number | null = null;
    for (let page = 1; page <= reconcilePages; page++) {
      const res = await o.client!.listStudents(cursor, page, PAGE_SIZE);
      for (const item of res.items ?? []) {
        if (await applyStatus(item)) stats.reconciled++;
        const at = item.updated_at ? Date.parse(item.updated_at) : NaN;
        if (!Number.isNaN(at) && (max === null || at > max)) max = at;
      }
      if (!res.items || res.items.length < PAGE_SIZE || page * PAGE_SIZE >= (res.total ?? 0)) break;
    }
    /* 1 ms back: `updated_since` is exclusive, so rows sharing the last instant are read again rather than missed. */
    const next = max !== null ? new Date(max - 1).toISOString() : cursor;
    await ds.query(
      `INSERT INTO "lms_sync_state" ("key", "value", "updatedAt") VALUES ($1, $2, now())
       ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()`,
      [key, next],
    );
  }

  async function guarded(step: string, stats: SyncCycleStats, fn: () => Promise<void>): Promise<boolean> {
    try {
      await fn();
      return true;
    } catch (err) {
      if (!(err instanceof LmsError)) throw err;
      stats.lmsUnavailable = stats.lmsUnavailable || err.retryable;
      stats.errorCode = err.code;
      log.warn({ ...errInfo(err), step }, 'lms sync: step stopped');
      return false;
    }
  }

  return {
    enabled: !!o.client,
    tenantCode: tenant,
    async runCycle() {
      if (!o.client) return { ...emptyStats(), ran: false, reason: 'disabled' };
      const qr = ds.createQueryRunner();
      await qr.connect();
      try {
        const [{ locked }] = (await qr.query(`SELECT pg_try_advisory_lock($1) AS "locked"`, [LOCK_KEY])) as { locked: boolean }[];
        if (!locked) return { ...emptyStats(), ran: false, reason: 'locked' };
        try {
          const stats = emptyStats();
          stats.notEligible = await markNotEligible();
          for (let i = 0; i < maxBatches; i++) {
            const { more } = await sendBatch(stats);
            if (!more) break;
          }
          if (!stats.lmsUnavailable) {
            const ok = await guarded('follow', stats, () => follow(stats));
            if (ok) await guarded('reconcile', stats, () => reconcile(stats));
          }
          if (stats.sent || stats.rejected || stats.failed || stats.deferred || stats.followed || stats.reconciled || stats.missingFields)
            log.info({ stats }, 'lms sync: cycle done');
          return stats;
        } finally {
          await qr.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]);
        }
      } finally {
        await qr.release();
      }
    },
  };
}
