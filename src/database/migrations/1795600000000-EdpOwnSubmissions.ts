import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * EDP portal submissions stay in the EDP system: a submitted application is no longer copied into the Amrut admin
 * panel's student register. The application row itself is the submitted record (its form data, encrypted Aadhaar and
 * files are kept), with its own registration ID (EDP-000001), registration number (MMDDHHmmssSSSfff, as students) and
 * the Aadhaar blind index + last four digits for the duplicate check and masked display.
 *
 * - registrationCode / registrationNumber are unique among non-deleted applications.
 * - One submitted application per Aadhaar (partial unique index on the blind index).
 * - Applications submitted earlier (studentId set) keep their link to the student register and are read from there.
 */
export class EdpOwnSubmissions1795600000000 implements MigrationInterface {
  name = 'EdpOwnSubmissions1795600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE SEQUENCE IF NOT EXISTS "edp_registration_code_seq" START 1`);
    await q.query(`ALTER TABLE "edp_applications" ADD COLUMN "registrationCode" varchar(20) NULL`);
    await q.query(`ALTER TABLE "edp_applications" ADD COLUMN "registrationNumber" varchar(16) NULL`);
    await q.query(`ALTER TABLE "edp_applications" ADD COLUMN "aadhaarBidx" char(64) NULL`);
    await q.query(`ALTER TABLE "edp_applications" ADD COLUMN "aadhaarLast4" char(4) NULL`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_edp_applications_registration_code" ON "edp_applications" ("registrationCode") WHERE "isDelete" = false AND "registrationCode" IS NOT NULL`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_edp_applications_registration_number" ON "edp_applications" ("registrationNumber") WHERE "isDelete" = false AND "registrationNumber" IS NOT NULL`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_edp_applications_submitted_aadhaar" ON "edp_applications" ("aadhaarBidx") WHERE "isDelete" = false AND "status" = 'SUBMITTED' AND "aadhaarBidx" IS NOT NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const i of ['UQ_edp_applications_submitted_aadhaar', 'UQ_edp_applications_registration_number', 'UQ_edp_applications_registration_code'])
      await q.query(`DROP INDEX IF EXISTS "${i}"`);
    for (const c of ['aadhaarLast4', 'aadhaarBidx', 'registrationNumber', 'registrationCode'])
      await q.query(`ALTER TABLE "edp_applications" DROP COLUMN IF EXISTS "${c}"`);
    await q.query(`DROP SEQUENCE IF EXISTS "edp_registration_code_seq"`);
  }
}
