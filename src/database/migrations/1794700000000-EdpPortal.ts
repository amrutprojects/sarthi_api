import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * ENTREPRENEURSHIP DEVELOPMENT PROGRAM (EDP) portal: the tables behind edp.sumago.ai. Additive only; no existing table
 * is changed.
 *
 * - edp_accounts: a student's portal sign-in (email + bcrypt password), verified by an emailed one-time code. The code
 *   is stored as an HMAC only, with its expiry, wrong-attempt count and send counter.
 * - edp_applications: one per account; the form draft step by step (Aadhaar encrypted, never in the JSON), its stage,
 *   and, once submitted, the students row it created (the student register stays the record of truth after that).
 * - edp_application_files: document files uploaded in step 3 before submission (private storage, edp/<application>/).
 * - edp_admins: sign-ins of the separate tracking panel (edp.sumago.ai/manage); not Amrut admin panel users.
 */
export class EdpPortal1794700000000 implements MigrationInterface {
  name = 'EdpPortal1794700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "edp_accounts" (
        "id"              uuid         NOT NULL DEFAULT gen_random_uuid(),
        "firstName"       varchar(100) NOT NULL,
        "middleName"      varchar(100) NULL,
        "lastName"        varchar(100) NOT NULL,
        "email"           varchar(254) NOT NULL,
        "mobile"          varchar(16)  NOT NULL,
        "passwordHash"    varchar(255) NOT NULL,
        "emailVerifiedAt" timestamptz  NULL,
        "otpHash"         char(64)     NULL,
        "otpExpiresAt"    timestamptz  NULL,
        "otpSentAt"       timestamptz  NULL,
        "otpAttempts"     integer      NOT NULL DEFAULT 0,
        "otpSendCount"    integer      NOT NULL DEFAULT 0,
        "otpWindowStart"  timestamptz  NULL,
        "lastLoginAt"     timestamptz  NULL,
        "createdAt"       timestamptz  NOT NULL DEFAULT now(),
        "updatedAt"       timestamptz  NOT NULL DEFAULT now(),
        "isDelete"        boolean      NOT NULL DEFAULT false,
        "isActive"        boolean      NOT NULL DEFAULT true,
        CONSTRAINT "PK_edp_accounts" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_edp_accounts_email_lower" CHECK ("email" = lower("email"))
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_edp_accounts_email" ON "edp_accounts" ("email") WHERE "isDelete" = false`);

    await q.query(`
      CREATE TABLE "edp_applications" (
        "id"               uuid         NOT NULL DEFAULT gen_random_uuid(),
        "accountId"        uuid         NOT NULL,
        "status"           varchar(20)  NOT NULL DEFAULT 'DRAFT',
        "currentStep"      smallint     NOT NULL DEFAULT 1,
        "data"             jsonb        NOT NULL DEFAULT '{}'::jsonb,
        "barcodes"         jsonb        NOT NULL DEFAULT '{}'::jsonb,
        "aadhaarEnc"       bytea        NULL,
        "basicCompletedAt" timestamptz  NULL,
        "mainCompletedAt"  timestamptz  NULL,
        "studentId"        uuid         NULL,
        "submittedAt"      timestamptz  NULL,
        "resubmittedAt"    timestamptz  NULL,
        "editUsed"         boolean      NOT NULL DEFAULT false,
        "createdAt"        timestamptz  NOT NULL DEFAULT now(),
        "updatedAt"        timestamptz  NOT NULL DEFAULT now(),
        "isDelete"         boolean      NOT NULL DEFAULT false,
        "isActive"         boolean      NOT NULL DEFAULT true,
        CONSTRAINT "PK_edp_applications" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_edp_applications_account" UNIQUE ("accountId"),
        CONSTRAINT "CHK_edp_applications_status" CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'EDITING', 'RESUBMITTED')),
        CONSTRAINT "CHK_edp_applications_step" CHECK ("currentStep" BETWEEN 1 AND 3),
        CONSTRAINT "FK_edp_applications_account" FOREIGN KEY ("accountId") REFERENCES "edp_accounts"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_edp_applications_student" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE SET NULL
      )`);
    await q.query(`CREATE INDEX "IDX_edp_applications_studentId" ON "edp_applications" ("studentId")`);

    await q.query(`
      CREATE TABLE "edp_application_files" (
        "id"            uuid         NOT NULL DEFAULT gen_random_uuid(),
        "applicationId" uuid         NOT NULL,
        "docType"       varchar(40)  NOT NULL,
        "storageKey"    varchar(500) NOT NULL,
        "originalName"  varchar(255) NOT NULL,
        "mimeType"      varchar(100) NOT NULL,
        "sizeBytes"     integer      NOT NULL,
        "sha256"        char(64)     NOT NULL,
        "createdAt"     timestamptz  NOT NULL DEFAULT now(),
        "updatedAt"     timestamptz  NOT NULL DEFAULT now(),
        "isDelete"      boolean      NOT NULL DEFAULT false,
        "isActive"      boolean      NOT NULL DEFAULT true,
        CONSTRAINT "PK_edp_application_files" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_edp_application_files_type" UNIQUE ("applicationId", "docType"),
        CONSTRAINT "FK_edp_application_files_application" FOREIGN KEY ("applicationId") REFERENCES "edp_applications"("id") ON DELETE CASCADE
      )`);

    await q.query(`
      CREATE TABLE "edp_admins" (
        "id"           uuid         NOT NULL DEFAULT gen_random_uuid(),
        "name"         varchar(150) NOT NULL,
        "email"        varchar(254) NOT NULL,
        "passwordHash" varchar(255) NOT NULL,
        "lastLoginAt"  timestamptz  NULL,
        "createdAt"    timestamptz  NOT NULL DEFAULT now(),
        "updatedAt"    timestamptz  NOT NULL DEFAULT now(),
        "isDelete"     boolean      NOT NULL DEFAULT false,
        "isActive"     boolean      NOT NULL DEFAULT true,
        CONSTRAINT "PK_edp_admins" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_edp_admins_email_lower" CHECK ("email" = lower("email"))
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_edp_admins_email" ON "edp_admins" ("email") WHERE "isDelete" = false`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "edp_admins"`);
    await q.query(`DROP TABLE IF EXISTS "edp_application_files"`);
    await q.query(`DROP TABLE IF EXISTS "edp_applications"`);
    await q.query(`DROP TABLE IF EXISTS "edp_accounts"`);
  }
}
