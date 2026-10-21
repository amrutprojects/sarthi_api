import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Students still without a registration number after 1793500000000 (imported in one batch, so they share one createdAt
 * and only the first could take it). Each gets a number from the database clock at the moment this runs, one by one,
 * in MMDDHHmmssSSSfff (Asia/Kolkata), skipping numbers already used. Real readings only; nothing is padded or invented.
 * These numbers show when the number was assigned, not when the student was imported.
 */
export class RemainingRegistrationNumbers1793600000000 implements MigrationInterface {
  name = 'RemainingRegistrationNumbers1793600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      DECLARE r record; n text;
      BEGIN
        FOR r IN SELECT "id" FROM "students" WHERE "registrationNumber" IS NULL ORDER BY "createdAt", "id" LOOP
          LOOP
            n := to_char(clock_timestamp() AT TIME ZONE 'Asia/Kolkata', 'MMDDHH24MISSMS')
                 || substr(to_char(clock_timestamp() AT TIME ZONE 'Asia/Kolkata', 'US'), 4, 3);
            EXIT WHEN NOT EXISTS (SELECT 1 FROM "students" WHERE "registrationNumber" = n);
          END LOOP;
          UPDATE "students" SET "registrationNumber" = n WHERE "id" = r."id";
        END LOOP;
      END $$`);
  }

  public async down(): Promise<void> {
    /* Numbers once issued are kept. */
  }
}
