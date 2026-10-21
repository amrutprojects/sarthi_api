import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Imported students also carry a registration number (MMDDHHmmssSSSfff), allocated at import finalisation from now on.
 * This backfills students that have none yet, from their createdAt (microsecond precision) in Asia/Kolkata. A number
 * already used by another student, or shared by two rows created in the same microsecond, is skipped (left NULL) rather
 * than invented; the UNIQUE index stays the guarantee.
 */
export class ImportedRegistrationNumbers1793500000000 implements MigrationInterface {
  name = 'ImportedRegistrationNumbers1793500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      WITH candidates AS (
        SELECT "id",
               to_char("createdAt" AT TIME ZONE 'Asia/Kolkata', 'MMDDHH24MISSMS')
                 || substr(to_char("createdAt" AT TIME ZONE 'Asia/Kolkata', 'US'), 4, 3) AS num
        FROM "students"
        WHERE "registrationNumber" IS NULL
      ),
      ranked AS (
        SELECT "id", num, ROW_NUMBER() OVER (PARTITION BY num ORDER BY "id") AS rn FROM candidates
      )
      UPDATE "students" s SET "registrationNumber" = r.num
      FROM ranked r
      WHERE s."id" = r."id" AND r.rn = 1
        AND NOT EXISTS (SELECT 1 FROM "students" x WHERE x."registrationNumber" = r.num)`);
  }

  public async down(): Promise<void> {
    /* Numbers once issued are kept: removing them could break references made with them. */
  }
}
