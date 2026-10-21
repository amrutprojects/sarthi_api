import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Student registration number: YYYYMMDDHHmmss + milliseconds (3) + microseconds (6) = 23 digits, in the application
 * timezone, allocated by the backend (see registration-number.ts). It is a new, additional identifier: the primary key
 * and the existing codes (REG-000001, STU-000001) are unchanged.
 * - CHECK: exactly 23 digits. UNIQUE across all rows (deleted ones included), so a number is never issued twice.
 * - Existing registrations are backfilled from their createdAt (stored with microsecond precision) in Asia/Kolkata;
 *   if two happen to share the same instant, only the earliest row by id gets it and the others stay NULL.
 */
export class RegistrationNumber1793300000000 implements MigrationInterface {
  name = 'RegistrationNumber1793300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "students" ADD COLUMN "registrationNumber" varchar(23) NULL`);
    await q.query(`ALTER TABLE "students" ADD CONSTRAINT "CHK_students_registration_number" CHECK ("registrationNumber" ~ '^[0-9]{23}$')`);
    await q.query(`CREATE UNIQUE INDEX "UQ_students_registration_number" ON "students" ("registrationNumber")`);
    await q.query(`
      WITH candidates AS (
        SELECT "id",
               to_char("createdAt" AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDDHH24MISSMS')
                 || to_char("createdAt" AT TIME ZONE 'Asia/Kolkata', 'US') AS num,
               ROW_NUMBER() OVER (PARTITION BY "createdAt" ORDER BY "id") AS rn
        FROM "students"
        WHERE "source" = 'PUBLIC_REGISTRATION' AND "registrationNumber" IS NULL
      )
      UPDATE "students" s SET "registrationNumber" = c.num
      FROM candidates c
      WHERE s."id" = c."id" AND c.rn = 1`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "UQ_students_registration_number"`);
    await q.query(`ALTER TABLE "students" DROP CONSTRAINT "CHK_students_registration_number"`);
    await q.query(`ALTER TABLE "students" DROP COLUMN "registrationNumber"`);
  }
}
