import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * M1 Amrut → LMS student sync (src/modules/lms-sync, docs/lms-sync/README.md).
 *
 * - student_lms_link: one row per student and LMS tenant; the sync flag
 *   (NOT_SYNCED / PENDING / SENT / SYNCED / FAILED / REVIEW), the LMS learner id and code, the LMS intake request id
 *   and status, the checksum of the payload last sent, attempts, the last error code and the timestamps.
 *   UNIQUE (studentId, lmsTenantCode). Error details hold field names and codes only, never values.
 * - lms_sync_state: small key/value store of the worker (the reconciliation cursor per tenant).
 *
 * New tables only: the students table and the import are not touched (the worker reads students).
 */
export class StudentLmsLink1798510000000 implements MigrationInterface {
  name = 'StudentLmsLink1798510000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "student_lms_link" (
        "id"                  uuid        NOT NULL DEFAULT gen_random_uuid(),
        "createdAt"           timestamptz NOT NULL DEFAULT now(),
        "updatedAt"           timestamptz NOT NULL DEFAULT now(),
        "isDelete"            boolean     NOT NULL DEFAULT false,
        "isActive"            boolean     NOT NULL DEFAULT true,
        "studentId"           uuid        NOT NULL,
        "lmsTenantCode"       varchar(40) NOT NULL,
        "syncStatus"          varchar(12) NOT NULL DEFAULT 'NOT_SYNCED',
        "lmsLearnerId"        varchar(64) NULL,
        "lmsLearnerCode"      varchar(64) NULL,
        "lmsRequestId"        varchar(64) NULL,
        "lmsStatus"           varchar(30) NULL,
        "lmsReasonCodes"      jsonb       NOT NULL DEFAULT '[]'::jsonb,
        "payloadChecksum"     char(64)    NULL,
        "studentUpdatedAt"    timestamptz NULL,
        "sourceUpdatedAtSent" timestamptz NULL,
        "attempts"            integer     NOT NULL DEFAULT 0,
        "lastErrorCode"       varchar(60) NULL,
        "lastErrorDetails"    jsonb       NOT NULL DEFAULT '[]'::jsonb,
        "nextAttemptAt"       timestamptz NULL,
        "queuedAt"            timestamptz NULL,
        "lastSentAt"          timestamptz NULL,
        "lastSyncedAt"        timestamptz NULL,
        "lastCheckedAt"       timestamptz NULL,
        CONSTRAINT "PK_student_lms_link" PRIMARY KEY ("id"),
        CONSTRAINT "FK_student_lms_link_student" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_student_lms_link_status"
          CHECK ("syncStatus" IN ('NOT_SYNCED', 'PENDING', 'SENT', 'SYNCED', 'FAILED', 'REVIEW')),
        CONSTRAINT "CHK_student_lms_link_attempts" CHECK ("attempts" >= 0)
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_student_lms_link_student_tenant" ON "student_lms_link" ("studentId", "lmsTenantCode")`);
    await q.query(`CREATE INDEX "IDX_student_lms_link_tenant_status" ON "student_lms_link" ("lmsTenantCode", "syncStatus")`);
    await q.query(`CREATE INDEX "IDX_student_lms_link_request" ON "student_lms_link" ("lmsRequestId") WHERE "lmsRequestId" IS NOT NULL`);
    await q.query(
      `CREATE TRIGGER "TRG_student_lms_link_updated_at" BEFORE UPDATE ON "student_lms_link" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`,
    );

    await q.query(`
      CREATE TABLE "lms_sync_state" (
        "key"       varchar(80) NOT NULL,
        "value"     text        NOT NULL,
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lms_sync_state" PRIMARY KEY ("key")
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "lms_sync_state"`);
    await q.query(`DROP TABLE IF EXISTS "student_lms_link"`);
  }
}
