import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Registration number format changes from YYYYMMDDHHmmssSSSffffff (23 digits) to MMDDHHmmssSSSfff (16 digits):
 * the year is dropped, and only the microseconds within the millisecond are kept (the 6-digit part repeated the
 * milliseconds). Existing numbers are converted in place:
 *   old  YYYY MMDDHHmmss SSS fff fff    (positions 1-4, 5-14, 15-17, 18-20, 21-23)
 *   new       MMDDHHmmss SSS     fff    (positions 5-14, 15-17, 21-23)
 * The UNIQUE index stays; the CHECK and column length follow the new format.
 */
export class RegistrationNumberShort1793400000000 implements MigrationInterface {
  name = 'RegistrationNumberShort1793400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "students" DROP CONSTRAINT "CHK_students_registration_number"`);
    await q.query(`
      UPDATE "students"
      SET "registrationNumber" = substr("registrationNumber", 5, 13) || substr("registrationNumber", 21, 3)
      WHERE "registrationNumber" IS NOT NULL AND char_length("registrationNumber") = 23`);
    await q.query(`ALTER TABLE "students" ALTER COLUMN "registrationNumber" TYPE varchar(16)`);
    await q.query(`ALTER TABLE "students" ADD CONSTRAINT "CHK_students_registration_number" CHECK ("registrationNumber" ~ '^[0-9]{16}$')`);
  }

  public async down(q: QueryRunner): Promise<void> {
    /* The dropped year cannot be recovered from the number; rebuild the old format from createdAt instead. */
    await q.query(`ALTER TABLE "students" DROP CONSTRAINT "CHK_students_registration_number"`);
    await q.query(`ALTER TABLE "students" ALTER COLUMN "registrationNumber" TYPE varchar(23)`);
    await q.query(`
      UPDATE "students"
      SET "registrationNumber" = to_char("createdAt" AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDDHH24MISSMS')
                                 || to_char("createdAt" AT TIME ZONE 'Asia/Kolkata', 'US')
      WHERE "registrationNumber" IS NOT NULL`);
    await q.query(`ALTER TABLE "students" ADD CONSTRAINT "CHK_students_registration_number" CHECK ("registrationNumber" ~ '^[0-9]{23}$')`);
  }
}
