import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * M1 (inbound side of the LMS link, contract lms-api docs/contracts/multi-tenant/amrut-student-api.md):
 *
 * - api_keys: keys Amrut issues to the LMS (sent as X-Api-Key). Only a SHA-256 hash of the secret is kept, with a
 *   short public prefix for display and lookup. A rotated key stays valid until "expiresAt" (the overlap window);
 *   a revoked key is refused at once.
 * - lms_student_requests: one row per LMS create-or-match call (Idempotency-Key per LMS tenant), with what Amrut
 *   answered, so a retry replays the answer and never creates a second student.
 * - lms_student_reviews: a create Amrut holds for its own same-person / different-person decision (REVIEW). The
 *   normalised student values wait here (the Aadhaar number encrypted, as on import rows) until a reviewer decides.
 * - students_lms_code_seq: codes LMS-000001… of students created from the LMS (source = 'LMS').
 *
 * The student import and its tables are not touched.
 */
export class LmsIntegrationKeysAndStudents1798600000000 implements MigrationInterface {
  name = 'LmsIntegrationKeysAndStudents1798600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "api_keys" (
        "id"            uuid         NOT NULL DEFAULT gen_random_uuid(),
        "label"         varchar(100) NOT NULL,
        "prefix"        varchar(16)  NOT NULL,
        "secretHash"    char(64)     NOT NULL,
        "scopes"        text[]       NOT NULL,
        "status"        varchar(12)  NOT NULL DEFAULT 'ACTIVE',
        "expiresAt"     timestamptz  NULL,
        "createdById"   uuid         NULL,
        "rotatedAt"     timestamptz  NULL,
        "rotatedById"   uuid         NULL,
        "replacedById"  uuid         NULL,
        "rotatedFromId" uuid         NULL,
        "revokedAt"     timestamptz  NULL,
        "revokedById"   uuid         NULL,
        "revokedReason" varchar(300) NULL,
        "lastUsedAt"    timestamptz  NULL,
        "createdAt"     timestamptz  NOT NULL DEFAULT now(),
        "updatedAt"     timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_api_keys" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_api_keys_status" CHECK ("status" IN ('ACTIVE', 'REVOKED')),
        CONSTRAINT "FK_api_keys_createdBy" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_api_keys_rotatedBy" FOREIGN KEY ("rotatedById") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_api_keys_revokedBy" FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE SET NULL
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_api_keys_prefix" ON "api_keys" ("prefix")`);

    await q.query(`CREATE SEQUENCE "students_lms_code_seq"`);

    await q.query(`
      CREATE TABLE "lms_student_reviews" (
        "id"              uuid          NOT NULL DEFAULT gen_random_uuid(),
        "lmsTenantCode"   varchar(64)   NOT NULL,
        "lmsLearnerRef"   varchar(100)  NOT NULL,
        "status"          varchar(12)   NOT NULL DEFAULT 'PENDING',
        "matchStudentId"  uuid          NOT NULL,
        "matchTier"       varchar(4)    NOT NULL,
        "matchNote"       varchar(300)  NOT NULL,
        "data"            jsonb         NOT NULL,
        "aadhaarEnc"      bytea         NULL,
        "aadhaarBidx"     char(64)      NULL,
        "aadhaarLast4"    char(4)       NULL,
        "decision"        varchar(20)   NULL,
        "decisionReason"  varchar(500)  NULL,
        "decidedById"     uuid          NULL,
        "decidedAt"       timestamptz   NULL,
        "studentId"       uuid          NULL,
        "apiKeyId"        uuid          NULL,
        "createdAt"       timestamptz   NOT NULL DEFAULT now(),
        "updatedAt"       timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lms_student_reviews" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_lms_student_reviews_status" CHECK ("status" IN ('PENDING', 'DECIDED')),
        CONSTRAINT "CHK_lms_student_reviews_decision" CHECK ("decision" IS NULL OR "decision" IN ('SAME_PERSON', 'DIFFERENT_PERSON', 'HOLD')),
        CONSTRAINT "FK_lms_student_reviews_match" FOREIGN KEY ("matchStudentId") REFERENCES "students"("id"),
        CONSTRAINT "FK_lms_student_reviews_student" FOREIGN KEY ("studentId") REFERENCES "students"("id"),
        CONSTRAINT "FK_lms_student_reviews_decidedBy" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_lms_student_reviews_apiKey" FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE SET NULL
      )`);
    await q.query(`CREATE INDEX "IDX_lms_student_reviews_status" ON "lms_student_reviews" ("status", "createdAt")`);

    await q.query(`
      CREATE TABLE "lms_student_requests" (
        "id"              uuid          NOT NULL DEFAULT gen_random_uuid(),
        "lmsTenantCode"   varchar(64)   NOT NULL,
        "idempotencyKey"  varchar(100)  NOT NULL,
        "requestHash"     char(64)      NOT NULL,
        "lmsLearnerRef"   varchar(100)  NOT NULL,
        "result"          varchar(10)   NOT NULL,
        "tier"            varchar(4)    NULL,
        "studentId"       uuid          NULL,
        "reviewId"        uuid          NULL,
        "apiKeyId"        uuid          NULL,
        "createdAt"       timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lms_student_requests" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_lms_student_requests_result" CHECK ("result" IN ('CREATED', 'MATCHED', 'REVIEW')),
        CONSTRAINT "FK_lms_student_requests_student" FOREIGN KEY ("studentId") REFERENCES "students"("id"),
        CONSTRAINT "FK_lms_student_requests_review" FOREIGN KEY ("reviewId") REFERENCES "lms_student_reviews"("id"),
        CONSTRAINT "FK_lms_student_requests_apiKey" FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE SET NULL
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_lms_student_requests_key" ON "lms_student_requests" ("lmsTenantCode", "idempotencyKey")`);
    await q.query(`CREATE INDEX "IDX_lms_student_requests_learner" ON "lms_student_requests" ("lmsTenantCode", "lmsLearnerRef")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "lms_student_requests"`);
    await q.query(`DROP TABLE "lms_student_reviews"`);
    await q.query(`DROP SEQUENCE "students_lms_code_seq"`);
    await q.query(`DROP TABLE "api_keys"`);
  }
}
