import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * EDP portal: a form is submitted once and is final (the "edit once and resubmit" option is dropped). Applications in
 * the edit states become SUBMITTED, an unfinished edit's draft is cleared (the student register already holds the
 * submitted record), and the status check allows DRAFT and SUBMITTED only. The editUsed and resubmittedAt columns are
 * left in place, unused (no data is dropped).
 */
export class EdpSingleSubmission1794900000000 implements MigrationInterface {
  name = 'EdpSingleSubmission1794900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE "edp_applications" SET "status" = 'SUBMITTED', "data" = '{}'::jsonb, "aadhaarEnc" = NULL, "barcodes" = '{}'::jsonb
       WHERE "status" IN ('EDITING', 'RESUBMITTED')`,
    );
    await q.query(`ALTER TABLE "edp_applications" DROP CONSTRAINT "CHK_edp_applications_status"`);
    await q.query(`ALTER TABLE "edp_applications" ADD CONSTRAINT "CHK_edp_applications_status" CHECK ("status" IN ('DRAFT', 'SUBMITTED'))`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "edp_applications" DROP CONSTRAINT "CHK_edp_applications_status"`);
    await q.query(
      `ALTER TABLE "edp_applications" ADD CONSTRAINT "CHK_edp_applications_status" CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'EDITING', 'RESUBMITTED'))`,
    );
  }
}
