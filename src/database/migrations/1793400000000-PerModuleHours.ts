import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Hours move from the page to the MODULE, and the programme fact sheet becomes managed.
 *
 * Three changes, together because they reshape the same two tables:
 *
 * 1. The hour columns move from programme_module_settings onto programme_modules. They were one
 *    shared record, which said every module runs identically. Each module now carries its own, so
 *    one can run longer than another, and the programme's arithmetic
 *    (training + assessment = total) moves with them and is enforced per module.
 *
 * 2. `isElective` becomes `kind` — MAIN or ELECTIVE. A boolean could only ever answer one
 *    question; the admin panel offers this as a dropdown, and a named kind leaves room for a third
 *    sort of module without another column.
 *
 * 3. programme_module_settings gains the Modules page heading and the programme fact sheet shown
 *    on /programme (ideal duration, validity, security deposit, apply-before, partner). Total
 *    hours and the elective count are NOT stored: they are summed from the modules, so they cannot
 *    contradict them.
 *
 * Existing rows are carried over: every module inherits the hours that were shared, so the site
 * renders exactly as before.
 */
export class PerModuleHours1793400000000 implements MigrationInterface {
  name = 'PerModuleHours1793400000000';

  public async up(q: QueryRunner): Promise<void> {
    /* ---- 1. hours onto the module ---- */
    await q.query(`
      ALTER TABLE "programme_modules"
        ADD COLUMN "moduleHours"           integer      NULL,
        ADD COLUMN "trainingHours"         integer      NULL,
        ADD COLUMN "assessmentHours"       integer      NULL,
        ADD COLUMN "weeksPerModule"        integer      NULL,
        ADD COLUMN "daysPerWeek"           integer      NULL,
        ADD COLUMN "hoursPerDay"           integer      NULL,
        ADD COLUMN "weeklyAssessmentHours" numeric(4,1) NULL`);

    /* Every module inherits what was shared, so nothing a visitor sees changes. */
    await q.query(`
      UPDATE "programme_modules" m SET
        "moduleHours"           = s."moduleHours",
        "trainingHours"         = s."trainingHours",
        "assessmentHours"       = s."assessmentHours",
        "weeksPerModule"        = s."weeksPerModule",
        "daysPerWeek"           = s."daysPerWeek",
        "hoursPerDay"           = s."hoursPerDay",
        "weeklyAssessmentHours" = s."weeklyAssessmentHours"
      FROM "programme_module_settings" s
      WHERE s."id" = m."settingsId"`);

    await q.query(`
      ALTER TABLE "programme_modules"
        ALTER COLUMN "moduleHours"           SET NOT NULL,
        ALTER COLUMN "trainingHours"         SET NOT NULL,
        ALTER COLUMN "assessmentHours"       SET NOT NULL,
        ALTER COLUMN "weeksPerModule"        SET NOT NULL,
        ALTER COLUMN "daysPerWeek"           SET NOT NULL,
        ALTER COLUMN "hoursPerDay"           SET NOT NULL,
        ALTER COLUMN "weeklyAssessmentHours" SET NOT NULL`);

    /* The programme's arithmetic, now per module. */
    await q.query(`
      ALTER TABLE "programme_modules"
        ADD CONSTRAINT "CHK_programme_modules_hours"
          CHECK ("trainingHours" + "assessmentHours" = "moduleHours"),
        ADD CONSTRAINT "CHK_programme_modules_positive"
          CHECK ("moduleHours" >= 0 AND "trainingHours" >= 0 AND "assessmentHours" >= 0
                 AND "weeksPerModule" >= 0 AND "hoursPerDay" >= 0 AND "weeklyAssessmentHours" >= 0),
        ADD CONSTRAINT "CHK_programme_modules_days" CHECK ("daysPerWeek" BETWEEN 0 AND 7)`);

    await q.query(`
      ALTER TABLE "programme_module_settings"
        DROP CONSTRAINT IF EXISTS "CHK_programme_module_settings_hours",
        DROP CONSTRAINT IF EXISTS "CHK_programme_module_settings_positive",
        DROP CONSTRAINT IF EXISTS "CHK_programme_module_settings_days"`);
    await q.query(`
      ALTER TABLE "programme_module_settings"
        DROP COLUMN "moduleHours",
        DROP COLUMN "trainingHours",
        DROP COLUMN "assessmentHours",
        DROP COLUMN "weeksPerModule",
        DROP COLUMN "daysPerWeek",
        DROP COLUMN "hoursPerDay",
        DROP COLUMN "weeklyAssessmentHours"`);

    /* ---- 2. isElective becomes kind ---- */
    await q.query(`ALTER TABLE "programme_modules" ADD COLUMN "kind" varchar(16) NULL`);
    await q.query(
      `UPDATE "programme_modules" SET "kind" = CASE WHEN "isElective" THEN 'ELECTIVE' ELSE 'MAIN' END`,
    );
    await q.query(`ALTER TABLE "programme_modules" ALTER COLUMN "kind" SET NOT NULL`);
    await q.query(
      `ALTER TABLE "programme_modules"
         ADD CONSTRAINT "CHK_programme_modules_kind" CHECK ("kind" IN ('MAIN', 'ELECTIVE'))`,
    );
    await q.query(`ALTER TABLE "programme_modules" DROP COLUMN "isElective"`);

    /* ---- 3. the page heading and the programme fact sheet ---- */
    await q.query(`
      ALTER TABLE "programme_module_settings"
        ADD COLUMN "pageTitleMr"     varchar(200) NOT NULL DEFAULT 'मॉड्यूल्स — अमृत कलश',
        ADD COLUMN "pageTitleEn"     varchar(200) NOT NULL DEFAULT 'Modules — AMRUT KALASH',
        ADD COLUMN "pageSubtitleMr"  varchar(500) NOT NULL DEFAULT '',
        ADD COLUMN "pageSubtitleEn"  varchar(500) NOT NULL DEFAULT '',
        ADD COLUMN "idealMonths"     integer      NOT NULL DEFAULT 6,
        ADD COLUMN "validityMonths"  integer      NOT NULL DEFAULT 12,
        ADD COLUMN "securityDeposit" integer      NOT NULL DEFAULT 2000,
        ADD COLUMN "applyLeadDays"   integer      NOT NULL DEFAULT 30,
        ADD COLUMN "partnerName"     varchar(150) NOT NULL DEFAULT 'SUMAGO INFOTECH PVT LTD'`);

    /* The sentence the site already showed, so the page is unchanged by this migration. */
    await q.query(`
      UPDATE "programme_module_settings" SET
        "pageSubtitleMr" = 'चार मॉड्यूल्स, प्रत्येकी १२० तास. मॉड्यूल ३ व ४ मध्ये १० पैकी एक रोजगार क्षेत्र निवडावे लागते.',
        "pageSubtitleEn" = 'Four modules of 120 hours each. In Modules 3 and 4 the candidate selects one of 10 employment domains.'
      WHERE "pageSubtitleMr" = ''`);

    await q.query(`
      ALTER TABLE "programme_module_settings"
        ADD CONSTRAINT "CHK_programme_module_settings_facts"
          CHECK ("idealMonths" >= 0 AND "validityMonths" >= 0
                 AND "securityDeposit" >= 0 AND "applyLeadDays" >= 0),
        ADD CONSTRAINT "CHK_programme_module_settings_partner" CHECK (btrim("partnerName") <> '')`);
  }

  /*
   * Back to one shared record. The hours of the first module (by display order) become the shared
   * values — the modules may have diverged since, and there is no honest way to collapse several
   * different timetables into one, so the rest are discarded rather than averaged.
   */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "programme_module_settings"
        ADD COLUMN "moduleHours"           integer      NULL,
        ADD COLUMN "trainingHours"         integer      NULL,
        ADD COLUMN "assessmentHours"       integer      NULL,
        ADD COLUMN "weeksPerModule"        integer      NULL,
        ADD COLUMN "daysPerWeek"           integer      NULL,
        ADD COLUMN "hoursPerDay"           integer      NULL,
        ADD COLUMN "weeklyAssessmentHours" numeric(4,1) NULL`);

    await q.query(`
      UPDATE "programme_module_settings" s SET
        "moduleHours" = f."moduleHours", "trainingHours" = f."trainingHours",
        "assessmentHours" = f."assessmentHours", "weeksPerModule" = f."weeksPerModule",
        "daysPerWeek" = f."daysPerWeek", "hoursPerDay" = f."hoursPerDay",
        "weeklyAssessmentHours" = f."weeklyAssessmentHours"
      FROM (
        SELECT DISTINCT ON (m."settingsId") m."settingsId", m."moduleHours", m."trainingHours",
               m."assessmentHours", m."weeksPerModule", m."daysPerWeek", m."hoursPerDay",
               m."weeklyAssessmentHours"
        FROM "programme_modules" m
        WHERE m."isDelete" = false
        ORDER BY m."settingsId", m."displayOrder", m."no"
      ) f
      WHERE f."settingsId" = s."id"`);

    /* A configuration with no modules at all has nothing to restore from. */
    await q.query(`
      UPDATE "programme_module_settings" SET
        "moduleHours" = COALESCE("moduleHours", 120),
        "trainingHours" = COALESCE("trainingHours", 99),
        "assessmentHours" = COALESCE("assessmentHours", 21),
        "weeksPerModule" = COALESCE("weeksPerModule", 6),
        "daysPerWeek" = COALESCE("daysPerWeek", 6),
        "hoursPerDay" = COALESCE("hoursPerDay", 3),
        "weeklyAssessmentHours" = COALESCE("weeklyAssessmentHours", 3.5)`);

    await q.query(`
      ALTER TABLE "programme_module_settings"
        ALTER COLUMN "moduleHours" SET NOT NULL, ALTER COLUMN "trainingHours" SET NOT NULL,
        ALTER COLUMN "assessmentHours" SET NOT NULL, ALTER COLUMN "weeksPerModule" SET NOT NULL,
        ALTER COLUMN "daysPerWeek" SET NOT NULL, ALTER COLUMN "hoursPerDay" SET NOT NULL,
        ALTER COLUMN "weeklyAssessmentHours" SET NOT NULL`);
    await q.query(`
      ALTER TABLE "programme_module_settings"
        ADD CONSTRAINT "CHK_programme_module_settings_hours"
          CHECK ("trainingHours" + "assessmentHours" = "moduleHours"),
        ADD CONSTRAINT "CHK_programme_module_settings_days" CHECK ("daysPerWeek" BETWEEN 0 AND 7)`);

    await q.query(`ALTER TABLE "programme_modules" ADD COLUMN "isElective" boolean NOT NULL DEFAULT false`);
    await q.query(`UPDATE "programme_modules" SET "isElective" = ("kind" = 'ELECTIVE')`);
    await q.query(`
      ALTER TABLE "programme_modules"
        DROP CONSTRAINT IF EXISTS "CHK_programme_modules_kind",
        DROP CONSTRAINT IF EXISTS "CHK_programme_modules_hours",
        DROP CONSTRAINT IF EXISTS "CHK_programme_modules_positive",
        DROP CONSTRAINT IF EXISTS "CHK_programme_modules_days"`);
    await q.query(`
      ALTER TABLE "programme_modules"
        DROP COLUMN "kind", DROP COLUMN "moduleHours", DROP COLUMN "trainingHours",
        DROP COLUMN "assessmentHours", DROP COLUMN "weeksPerModule", DROP COLUMN "daysPerWeek",
        DROP COLUMN "hoursPerDay", DROP COLUMN "weeklyAssessmentHours"`);

    await q.query(`
      ALTER TABLE "programme_module_settings"
        DROP CONSTRAINT IF EXISTS "CHK_programme_module_settings_facts",
        DROP CONSTRAINT IF EXISTS "CHK_programme_module_settings_partner"`);
    await q.query(`
      ALTER TABLE "programme_module_settings"
        DROP COLUMN "pageTitleMr", DROP COLUMN "pageTitleEn",
        DROP COLUMN "pageSubtitleMr", DROP COLUMN "pageSubtitleEn",
        DROP COLUMN "idealMonths", DROP COLUMN "validityMonths",
        DROP COLUMN "securityDeposit", DROP COLUMN "applyLeadDays", DROP COLUMN "partnerName"`);
  }
}
