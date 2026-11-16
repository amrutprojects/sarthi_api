import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Student import: every column of the source's approver dashboard export has a home in the student register.
 *
 * The profile columns (gender, addresses, district/taluka ids, alternate contacts, disability, qualification details)
 * already exist (migration 1795300000000). This adds what an imported application carries beyond them:
 *   districtName, talukaName, division  as received (the ids are set only when they match the geography masters);
 *   schemeName, sourceSubmittedAt, sourceUpdatedAt, sourceRemarks  the source's own record details;
 *   sourceExtra  any other column of the file, as supplied (identity-number columns are never stored here).
 * All nullable (sourceExtra defaults to {}), so existing students and the other entry points are unchanged.
 *
 * CHK_students_import_approved required every imported student to carry an approval date. An application the source
 * has not approved yet may now be imported when a reviewer accepts its NOT_APPROVED issue: it is added as pending
 * approval (status REGISTRATION_PENDING, like a public registration: never offered for a batch). The constraint now
 * reads: an imported student has an import batch, and an approval date unless it is pending approval. An eligible
 * (RECEIVED) imported student without approval evidence remains impossible; the approved import that promotes a
 * pending one sets the status and the approval date in the same statement.
 */
export class StudentImportSourceDetails1796100000000 implements MigrationInterface {
  name = 'StudentImportSourceDetails1796100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "students"
        ADD COLUMN "districtName" varchar(100) NULL,
        ADD COLUMN "talukaName" varchar(100) NULL,
        ADD COLUMN "division" varchar(100) NULL,
        ADD COLUMN "schemeName" varchar(150) NULL,
        ADD COLUMN "sourceSubmittedAt" timestamptz NULL,
        ADD COLUMN "sourceUpdatedAt" timestamptz NULL,
        ADD COLUMN "sourceRemarks" varchar(1000) NULL,
        ADD COLUMN "sourceExtra" jsonb NOT NULL DEFAULT '{}'::jsonb`);
    await q.query(`ALTER TABLE "students" DROP CONSTRAINT "CHK_students_import_approved"`);
    await q.query(
      `ALTER TABLE "students" ADD CONSTRAINT "CHK_students_import_approved"
         CHECK ("source" <> 'IMPORT' OR ("importBatchId" IS NOT NULL AND ("approvedAt" IS NOT NULL OR "status" = 'REGISTRATION_PENDING')))`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    /* Imported students still pending approval would violate the original rule: it is restored for new rows only. */
    await q.query(`ALTER TABLE "students" DROP CONSTRAINT "CHK_students_import_approved"`);
    await q.query(
      `ALTER TABLE "students" ADD CONSTRAINT "CHK_students_import_approved"
         CHECK ("source" <> 'IMPORT' OR ("approvedAt" IS NOT NULL AND "importBatchId" IS NOT NULL)) NOT VALID`,
    );
    await q.query(`
      ALTER TABLE "students"
        DROP COLUMN "sourceExtra",
        DROP COLUMN "sourceRemarks",
        DROP COLUMN "sourceUpdatedAt",
        DROP COLUMN "sourceSubmittedAt",
        DROP COLUMN "schemeName",
        DROP COLUMN "division",
        DROP COLUMN "talukaName",
        DROP COLUMN "districtName"`);
  }
}
