import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Programme Page Management → "Programme fact sheet": Ideal duration and Validity can be a range of months ("4-6")
 * as well as a single number ("6").
 *
 * programme_page_settings."idealMonths" and "validityMonths" become varchar(7) holding the normalised form the API
 * writes: "N" or "N-M", ASCII hyphen, no spaces, no leading zeros ("240-240", the longest, is 7 characters). Each
 * existing number is carried over as its text, so the site shows exactly what it showed before; no "updatedAt"
 * changes. Every stored value went through the API's 0-120 / 0-240 caps or the seed, so each fits the new CHECKs.
 *
 * The CHECKs admit the format only; the caps (120 / 240) and "smaller number first" are the API's rules, as the caps
 * always were. CHK_programme_page_settings_facts is re-created for the two figures that stay integers.
 *
 * down() is LOSSY: a range keeps only its first number ("4-6" becomes 4).
 */
const FORMAT = `'^(0|[1-9][0-9]{0,2})(-(0|[1-9][0-9]{0,2}))?$'`;

export class ProgrammeMonthRanges1797700000000 implements MigrationInterface {
  name = 'ProgrammeMonthRanges1797700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "programme_page_settings" DROP CONSTRAINT IF EXISTS "CHK_programme_page_settings_facts"`);
    /* USING is not applied to a column's default, so each default is dropped first and set again in the new type. */
    await q.query(`
      ALTER TABLE "programme_page_settings"
        ALTER COLUMN "idealMonths"    DROP DEFAULT,
        ALTER COLUMN "idealMonths"    TYPE varchar(7) USING "idealMonths"::text,
        ALTER COLUMN "idealMonths"    SET DEFAULT '6',
        ALTER COLUMN "validityMonths" DROP DEFAULT,
        ALTER COLUMN "validityMonths" TYPE varchar(7) USING "validityMonths"::text,
        ALTER COLUMN "validityMonths" SET DEFAULT '12'`);
    await q.query(`
      ALTER TABLE "programme_page_settings"
        ADD CONSTRAINT "CHK_programme_page_settings_ideal_months" CHECK ("idealMonths" ~ ${FORMAT}),
        ADD CONSTRAINT "CHK_programme_page_settings_validity_months" CHECK ("validityMonths" ~ ${FORMAT}),
        ADD CONSTRAINT "CHK_programme_page_settings_facts" CHECK ("securityDeposit" >= 0 AND "applyLeadDays" >= 0)`);
  }

  /* Back to whole numbers. Lossy: a range keeps its first number. */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "programme_page_settings"
        DROP CONSTRAINT IF EXISTS "CHK_programme_page_settings_ideal_months",
        DROP CONSTRAINT IF EXISTS "CHK_programme_page_settings_validity_months",
        DROP CONSTRAINT IF EXISTS "CHK_programme_page_settings_facts"`);
    await q.query(`
      ALTER TABLE "programme_page_settings"
        ALTER COLUMN "idealMonths"    DROP DEFAULT,
        ALTER COLUMN "idealMonths"    TYPE integer USING split_part("idealMonths", '-', 1)::integer,
        ALTER COLUMN "idealMonths"    SET DEFAULT 6,
        ALTER COLUMN "validityMonths" DROP DEFAULT,
        ALTER COLUMN "validityMonths" TYPE integer USING split_part("validityMonths", '-', 1)::integer,
        ALTER COLUMN "validityMonths" SET DEFAULT 12`);
    await q.query(`
      ALTER TABLE "programme_page_settings"
        ADD CONSTRAINT "CHK_programme_page_settings_facts"
          CHECK ("idealMonths" >= 0 AND "validityMonths" >= 0
                 AND "securityDeposit" >= 0 AND "applyLeadDays" >= 0)`);
  }
}
