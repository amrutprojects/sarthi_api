import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * The programme fact sheet moves from the Modules page to the Programme page.
 *
 * The five entered figures (ideal duration, validity, security deposit, apply-before, partner) are
 * printed on /programme, so they now live with the rest of that page's content and are edited on
 * the Programme page screen. Total hours, the module line and the elective count are still NOT
 * stored anywhere: the site sums them from the modules, so they cannot contradict them.
 *
 * The values an administrator has already entered are carried over, so the site renders exactly as
 * before. The copy only happens when both singletons exist; otherwise the new columns keep the
 * defaults, which are the figures the seed has always written.
 */
export class ProgrammeFactSheet1793800000000 implements MigrationInterface {
  name = 'ProgrammeFactSheet1793800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "programme_page_settings"
        ADD COLUMN "idealMonths"     integer      NOT NULL DEFAULT 6,
        ADD COLUMN "validityMonths"  integer      NOT NULL DEFAULT 12,
        ADD COLUMN "securityDeposit" integer      NOT NULL DEFAULT 2000,
        ADD COLUMN "applyLeadDays"   integer      NOT NULL DEFAULT 30,
        ADD COLUMN "partnerName"     varchar(150) NOT NULL DEFAULT 'SUMAGO INFOTECH PVT LTD'`);

    /* What the Modules page held, so nothing a visitor sees changes. */
    await q.query(`
      UPDATE "programme_page_settings" p SET
        "idealMonths"     = s."idealMonths",
        "validityMonths"  = s."validityMonths",
        "securityDeposit" = s."securityDeposit",
        "applyLeadDays"   = s."applyLeadDays",
        "partnerName"     = s."partnerName"
      FROM "programme_module_settings" s
      WHERE p."isDelete" = false AND s."isDelete" = false`);

    await q.query(`
      ALTER TABLE "programme_page_settings"
        ADD CONSTRAINT "CHK_programme_page_settings_facts"
          CHECK ("idealMonths" >= 0 AND "validityMonths" >= 0
                 AND "securityDeposit" >= 0 AND "applyLeadDays" >= 0),
        ADD CONSTRAINT "CHK_programme_page_settings_partner" CHECK (btrim("partnerName") <> '')`);

    await q.query(`
      ALTER TABLE "programme_module_settings"
        DROP CONSTRAINT IF EXISTS "CHK_programme_module_settings_facts",
        DROP CONSTRAINT IF EXISTS "CHK_programme_module_settings_partner"`);
    await q.query(`
      ALTER TABLE "programme_module_settings"
        DROP COLUMN "idealMonths", DROP COLUMN "validityMonths",
        DROP COLUMN "securityDeposit", DROP COLUMN "applyLeadDays", DROP COLUMN "partnerName"`);
  }

  /* Back onto the Modules page, carrying the Programme page's current values with it. */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "programme_module_settings"
        ADD COLUMN "idealMonths"     integer      NOT NULL DEFAULT 6,
        ADD COLUMN "validityMonths"  integer      NOT NULL DEFAULT 12,
        ADD COLUMN "securityDeposit" integer      NOT NULL DEFAULT 2000,
        ADD COLUMN "applyLeadDays"   integer      NOT NULL DEFAULT 30,
        ADD COLUMN "partnerName"     varchar(150) NOT NULL DEFAULT 'SUMAGO INFOTECH PVT LTD'`);

    await q.query(`
      UPDATE "programme_module_settings" s SET
        "idealMonths"     = p."idealMonths",
        "validityMonths"  = p."validityMonths",
        "securityDeposit" = p."securityDeposit",
        "applyLeadDays"   = p."applyLeadDays",
        "partnerName"     = p."partnerName"
      FROM "programme_page_settings" p
      WHERE s."isDelete" = false AND p."isDelete" = false`);

    await q.query(`
      ALTER TABLE "programme_module_settings"
        ADD CONSTRAINT "CHK_programme_module_settings_facts"
          CHECK ("idealMonths" >= 0 AND "validityMonths" >= 0
                 AND "securityDeposit" >= 0 AND "applyLeadDays" >= 0),
        ADD CONSTRAINT "CHK_programme_module_settings_partner" CHECK (btrim("partnerName") <> '')`);

    await q.query(`
      ALTER TABLE "programme_page_settings"
        DROP CONSTRAINT IF EXISTS "CHK_programme_page_settings_facts",
        DROP CONSTRAINT IF EXISTS "CHK_programme_page_settings_partner"`);
    await q.query(`
      ALTER TABLE "programme_page_settings"
        DROP COLUMN "idealMonths", DROP COLUMN "validityMonths",
        DROP COLUMN "securityDeposit", DROP COLUMN "applyLeadDays", DROP COLUMN "partnerName"`);
  }
}
