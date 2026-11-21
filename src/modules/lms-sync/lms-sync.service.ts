import { AppDataSource } from '../../config/database.config';
import { env } from '../../config/env.config';
import { HTTP_STATUS } from '../../constants/api-response.constants';
import { AppError } from '../../shared/errors/app-error';
import { likePattern } from '../../shared/utils/pagination';
import { ELIGIBLE_STUDENT_SQL, SYNC_STATUSES, type SyncStatus } from './lms-sync.constants';
import { buildLmsRecord, missingRequiredFields, recordChecksum, type StudentSyncRow } from './lms-payload';
import { getLmsSyncWorker, triggerLmsSync } from './lms-sync.runtime';
import { STUDENT_SYNC_COLUMNS, STUDENT_SYNC_JOINS, type SyncCycleStats } from './lms-sync.worker';
import type { ListSyncQuery } from './lms-sync.validation';

/*
 * Admin side of the M1 sync (docs/lms-sync/README.md): the sync flag per student, one student's sync detail, and the
 * "Push to LMS" / "Retry" / "Run now" actions. Personal values are not returned here: code and name only (the
 * register's own endpoints show the rest, masked).
 */
const tenant = () => env.LMS_TENANT_CODE;
const ds = () => AppDataSource;

export interface SyncListItem {
  studentId: string;
  code: string;
  firstName: string;
  lastName: string;
  centreCode: string | null;
  trackCode: string | null;
  studentStatus: string;
  eligible: boolean;
  syncStatus: SyncStatus;
  lmsStatus: string | null;
  lmsLearnerCode: string | null;
  attempts: number;
  lastErrorCode: string | null;
  lastSentAt: string | null;
  lastSyncedAt: string | null;
  nextAttemptAt: string | null;
}

const LINK_COLUMNS = `
  COALESCE(l."syncStatus", 'NOT_SYNCED') AS "syncStatus", l."lmsStatus", l."lmsLearnerCode", COALESCE(l."attempts", 0)::int AS "attempts",
  l."lastErrorCode", l."lastSentAt", l."lastSyncedAt", l."nextAttemptAt"`;

export const lmsSyncService = {
  async summary() {
    const rows: { syncStatus: SyncStatus; n: string }[] = await ds().query(
      `SELECT COALESCE(l."syncStatus", 'NOT_SYNCED') AS "syncStatus", count(*) AS "n"
         FROM "students" s
         LEFT JOIN "student_lms_link" l ON l."studentId" = s."id" AND l."lmsTenantCode" = $1
        WHERE ${ELIGIBLE_STUDENT_SQL}
        GROUP BY 1`,
      [tenant()],
    );
    const byStatus = Object.fromEntries(SYNC_STATUSES.map((s) => [s, 0])) as Record<SyncStatus, number>;
    for (const r of rows) byStatus[r.syncStatus] = Number(r.n);
    return {
      tenantCode: tenant(),
      syncEnabled: getLmsSyncWorker().enabled,
      eligible: Object.values(byStatus).reduce((a, b) => a + b, 0),
      byStatus,
    };
  },

  async list(q: ListSyncQuery): Promise<{ items: SyncListItem[]; total: number }> {
    const where: string[] = [`s."isDelete" = false`];
    const params: unknown[] = [tenant()];
    if (q.scope === 'eligible') where.push(ELIGIBLE_STUDENT_SQL);
    if (q.syncStatus?.length) {
      params.push(q.syncStatus);
      where.push(`COALESCE(l."syncStatus", 'NOT_SYNCED') = ANY($${params.length})`);
    }
    if (q.search) {
      params.push(likePattern(q.search));
      const p = `$${params.length}`;
      where.push(
        `(s."code" ILIKE ${p} OR s."firstName" ILIKE ${p} OR s."lastName" ILIKE ${p} OR (s."firstName" || ' ' || s."lastName") ILIKE ${p})`,
      );
    }
    if (q.centre) {
      params.push(q.centre);
      where.push(`s."centreCode" = $${params.length}`);
    }
    if (q.errorCode) {
      params.push(q.errorCode);
      where.push(`l."lastErrorCode" = $${params.length}`);
    }
    const from = `FROM "students" s LEFT JOIN "student_lms_link" l ON l."studentId" = s."id" AND l."lmsTenantCode" = $1 WHERE ${where.join(' AND ')}`;
    const [{ total }] = (await ds().query(`SELECT count(*)::int AS "total" ${from}`, params)) as { total: number }[];
    params.push(q.limit, (q.page - 1) * q.limit);
    const items: SyncListItem[] = await ds().query(
      `SELECT s."id" AS "studentId", s."code", s."firstName", s."lastName", s."centreCode", s."trackCode", s."status" AS "studentStatus",
              (${ELIGIBLE_STUDENT_SQL}) AS "eligible", ${LINK_COLUMNS}
         ${from}
        ORDER BY COALESCE(l."updatedAt", s."updatedAt") DESC, s."code"
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items, total };
  },

  async detail(studentId: string) {
    const [row] = (await ds().query(
      `SELECT ${STUDENT_SYNC_COLUMNS}, s."status" AS "studentStatus", (${ELIGIBLE_STUDENT_SQL}) AS "eligible", s."updatedAt" AS "studentUpdatedAt",
              l."id" AS "linkId", ${LINK_COLUMNS}, l."lmsLearnerId", l."lmsRequestId", l."lmsReasonCodes", l."payloadChecksum",
              l."lastErrorDetails", l."queuedAt", l."lastCheckedAt", l."sourceUpdatedAtSent", l."createdAt" AS "linkCreatedAt"
         FROM "students" s
         ${STUDENT_SYNC_JOINS}
         LEFT JOIN "student_lms_link" l ON l."studentId" = s."id" AND l."lmsTenantCode" = $1
        WHERE s."id" = $2 AND s."isDelete" = false`,
      [tenant(), studentId],
    )) as (StudentSyncRow & Record<string, unknown>)[];
    if (!row) throw AppError.notFound('Student not found');
    const record = buildLmsRecord(row);
    const checksum = recordChecksum(record);
    return {
      studentId: row.id,
      code: row.code,
      firstName: row.firstName,
      lastName: row.lastName,
      studentStatus: row.studentStatus,
      eligible: row.eligible,
      tenantCode: tenant(),
      syncEnabled: getLmsSyncWorker().enabled,
      syncStatus: row.syncStatus,
      lmsLearnerId: row.lmsLearnerId ?? null,
      lmsLearnerCode: row.lmsLearnerCode ?? null,
      lmsRequestId: row.lmsRequestId ?? null,
      lmsStatus: row.lmsStatus ?? null,
      lmsReasonCodes: row.lmsReasonCodes ?? [],
      attempts: row.attempts,
      lastErrorCode: row.lastErrorCode ?? null,
      lastErrorDetails: row.lastErrorDetails ?? [],
      queuedAt: row.queuedAt ?? null,
      lastSentAt: row.lastSentAt ?? null,
      lastCheckedAt: row.lastCheckedAt ?? null,
      lastSyncedAt: row.lastSyncedAt ?? null,
      nextAttemptAt: row.nextAttemptAt ?? null,
      linkCreatedAt: row.linkCreatedAt ?? null,
      /* What the next send would carry: field names only, never values. */
      payload: {
        fields: Object.keys(record),
        missingRequiredFields: missingRequiredFields(record),
        checksum,
        lastSentChecksum: row.payloadChecksum ?? null,
        changedSinceLastSend: row.payloadChecksum ? row.payloadChecksum !== checksum : true,
      },
    };
  },

  /* "Push to LMS": queues each eligible student now (PENDING, no backoff), even when its data has not changed. */
  async push(studentIds: string[]) {
    const ids = [...new Set(studentIds)];
    const rows: { id: string; eligible: boolean }[] = await ds().query(
      `SELECT s."id", (${ELIGIBLE_STUDENT_SQL}) AS "eligible" FROM "students" s WHERE s."id" = ANY($1::uuid[]) AND s."isDelete" = false`,
      [ids],
    );
    const found = new Map(rows.map((r) => [r.id, r.eligible]));
    const queue = ids.filter((id) => found.get(id) === true);
    const skipped = ids
      .filter((id) => found.get(id) !== true)
      .map((studentId) => ({ studentId, reason: found.has(studentId) ? 'NOT_ELIGIBLE' : 'NOT_FOUND' }));
    if (queue.length)
      await ds().query(
        `INSERT INTO "student_lms_link" ("studentId", "lmsTenantCode", "syncStatus", "queuedAt")
         SELECT unnest($2::uuid[]), $1, 'PENDING', now()
         ON CONFLICT ("studentId", "lmsTenantCode") DO UPDATE
           SET "syncStatus" = 'PENDING', "queuedAt" = now(), "nextAttemptAt" = NULL, "attempts" = 0,
               "lastErrorCode" = NULL, "lastErrorDetails" = '[]'::jsonb`,
        [tenant(), queue],
      );
    const syncEnabled = getLmsSyncWorker().enabled;
    if (queue.length && syncEnabled) void triggerLmsSync();
    return { syncEnabled, queued: queue, skipped };
  },

  /* "Retry": FAILED links back to PENDING (the given students, or every failed one). */
  async retry(studentIds?: string[]) {
    const params: unknown[] = [tenant()];
    let filter = '';
    if (studentIds?.length) {
      params.push([...new Set(studentIds)]);
      filter = `AND "studentId" = ANY($2::uuid[])`;
    }
    const rows: { studentId: string }[] = await ds().query(
      `UPDATE "student_lms_link"
          SET "syncStatus" = 'PENDING', "queuedAt" = now(), "nextAttemptAt" = NULL, "attempts" = 0,
              "lastErrorCode" = NULL, "lastErrorDetails" = '[]'::jsonb
        WHERE "lmsTenantCode" = $1 AND "syncStatus" = 'FAILED' ${filter}
        RETURNING "studentId"`,
      params,
    );
    /* UPDATE … RETURNING through TypeORM gives [rows, count]. */
    const list = (Array.isArray(rows[0]) ? (rows[0] as unknown as { studentId: string }[]) : rows).map((r) => r.studentId);
    const syncEnabled = getLmsSyncWorker().enabled;
    if (list.length && syncEnabled) void triggerLmsSync();
    return { syncEnabled, queued: list };
  },

  /* "Run now": one full cycle, answered with its counts. */
  async run(): Promise<SyncCycleStats> {
    if (!getLmsSyncWorker().enabled)
      throw new AppError(HTTP_STATUS.CONFLICT, 'The LMS sync is switched off (LMS_SYNC_ENABLED)', 'LMS_SYNC_DISABLED');
    const stats = (await triggerLmsSync()) as SyncCycleStats | undefined;
    if (!stats) throw new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, 'The sync cycle failed; see the server log', 'LMS_SYNC_FAILED');
    return stats;
  },
};
