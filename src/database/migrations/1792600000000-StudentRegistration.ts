import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Public student registration writes to the existing students table: approval and import batch become nullable for
 * registrations only (a CHECK keeps them required for imported rows), a source column tells the two apart, and a
 * unique index stops two concurrent registrations with the same Aadhaar.
 */
export class StudentRegistration1792600000000 implements MigrationInterface {
  name = 'StudentRegistration1792600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "students" ADD COLUMN "source" varchar(30) NOT NULL DEFAULT 'IMPORT'`);
    await q.query(`ALTER TABLE "students" ALTER COLUMN "approvedAt" DROP NOT NULL`);
    await q.query(`ALTER TABLE "students" ALTER COLUMN "importBatchId" DROP NOT NULL`);
    await q.query(
      `ALTER TABLE "students" ADD CONSTRAINT "CHK_students_import_approved"
         CHECK ("source" <> 'IMPORT' OR ("approvedAt" IS NOT NULL AND "importBatchId" IS NOT NULL))`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_students_registration_aadhaar" ON "students" ("aadhaarBidx")
         WHERE "isDelete" = false AND "source" = 'PUBLIC_REGISTRATION' AND "aadhaarBidx" IS NOT NULL`,
    );
    await q.query(`CREATE SEQUENCE "student_registrations_code_seq"`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP SEQUENCE "student_registrations_code_seq"`);
    await q.query(`DROP INDEX "UQ_students_registration_aadhaar"`);
    await q.query(`ALTER TABLE "students" DROP CONSTRAINT "CHK_students_import_approved"`);
    await q.query(`DELETE FROM "students" WHERE "source" = 'PUBLIC_REGISTRATION'`);
    await q.query(`ALTER TABLE "students" ALTER COLUMN "importBatchId" SET NOT NULL`);
    await q.query(`ALTER TABLE "students" ALTER COLUMN "approvedAt" SET NOT NULL`);
    await q.query(`ALTER TABLE "students" DROP COLUMN "source"`);
  }
}
