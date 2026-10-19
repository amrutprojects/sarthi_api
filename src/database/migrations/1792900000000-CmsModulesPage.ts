import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * CMS Modules page: programme_module_settings (the hours and the learning-path split, one row),
 * programme_modules (the module cards) and programme_elective_domains (the employment domains the
 * two elective modules choose from).
 *
 * Follows the conventions of the earlier migrations: the common columns, RESTRICT foreign keys,
 * partial unique indexes over non-deleted rows, and the set_updated_at trigger.
 *
 * Bilingual columns for prose. The public site defaults to Marathi (useLang.tsx) and renders these
 * through bi(). Course titles are published in English only, as the programme publishes them, so
 * the two certificate columns are single-valued.
 *
 * The programme's own arithmetic is enforced here rather than left to the application:
 * training + assessment must equal the module total, and the two learning-path shares must total
 * 100. A page that contradicts itself is worse than one that refuses to save.
 *
 * Creates tables only; no existing table or row is touched.
 */
export class CmsModulesPage1792900000000 implements MigrationInterface {
  name = 'CmsModulesPage1792900000000';

  public async up(q: QueryRunner): Promise<void> {
    const base = `
      "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "isDelete"  boolean     NOT NULL DEFAULT false,
      "isActive"  boolean     NOT NULL DEFAULT true`;

    await q.query(`
      CREATE TABLE "programme_module_settings" (${base},
        "moduleHours"           integer      NOT NULL,
        "trainingHours"         integer      NOT NULL,
        "assessmentHours"       integer      NOT NULL,
        "weeksPerModule"        integer      NOT NULL,
        "daysPerWeek"           integer      NOT NULL,
        "hoursPerDay"           integer      NOT NULL,
        "weeklyAssessmentHours" numeric(4,1) NOT NULL,
        "sessionLengthMr"       varchar(40)  NOT NULL,
        "sessionLengthEn"       varchar(40)  NOT NULL,
        "sessionLabelMr"        varchar(80)  NOT NULL,
        "sessionLabelEn"        varchar(80)  NOT NULL,
        "fixedPathPct"          integer      NOT NULL,
        "selfPathPct"           integer      NOT NULL,
        "isPublished"           boolean      NOT NULL DEFAULT true,
        CONSTRAINT "PK_programme_module_settings" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_programme_module_settings_positive" CHECK (
          "moduleHours" >= 0 AND "trainingHours" >= 0 AND "assessmentHours" >= 0
          AND "weeksPerModule" >= 0 AND "hoursPerDay" >= 0 AND "weeklyAssessmentHours" >= 0
        ),
        CONSTRAINT "CHK_programme_module_settings_days" CHECK ("daysPerWeek" BETWEEN 0 AND 7),
        /* The programme's arithmetic: 99 training + 21 assessment = 120 per module. */
        CONSTRAINT "CHK_programme_module_settings_hours" CHECK ("trainingHours" + "assessmentHours" = "moduleHours"),
        /* The learning-path donut would misstate the split if these did not add up. */
        CONSTRAINT "CHK_programme_module_settings_path" CHECK ("fixedPathPct" + "selfPathPct" = 100)
      )`);

    await q.query(
      `CREATE UNIQUE INDEX "UQ_programme_module_settings_singleton" ON "programme_module_settings" ((true)) WHERE "isDelete" = false`,
    );

    await q.query(`
      CREATE TABLE "programme_modules" (${base},
        "settingsId"    uuid         NOT NULL,
        "no"            integer      NOT NULL,
        "code"          varchar(32)  NOT NULL,
        "nameMr"        varchar(300) NOT NULL,
        "nameEn"        varchar(300) NOT NULL,
        "descriptionMr" varchar(600) NOT NULL,
        "descriptionEn" varchar(600) NOT NULL,
        "isElective"    boolean      NOT NULL DEFAULT false,
        "displayOrder"  integer      NOT NULL DEFAULT 0,
        CONSTRAINT "PK_programme_modules" PRIMARY KEY ("id"),
        CONSTRAINT "FK_programme_modules_settings" FOREIGN KEY ("settingsId") REFERENCES "programme_module_settings"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_programme_modules_code" CHECK (btrim("code") <> '' AND "code" = upper("code")),
        CONSTRAINT "CHK_programme_modules_name_mr" CHECK (btrim("nameMr") <> ''),
        CONSTRAINT "CHK_programme_modules_name_en" CHECK (btrim("nameEn") <> ''),
        CONSTRAINT "CHK_programme_modules_order" CHECK ("displayOrder" >= 0 AND "no" >= 0)
      )`);

    /* The code identifies a module across the programme, so it cannot repeat among live rows. */
    await q.query(
      `CREATE UNIQUE INDEX "UQ_programme_modules_code" ON "programme_modules" ("settingsId", "code") WHERE "isDelete" = false`,
    );
    await q.query(
      `CREATE INDEX "IDX_programme_modules_settingsId" ON "programme_modules" ("settingsId")`,
    );

    await q.query(`
      CREATE TABLE "programme_elective_domains" (${base},
        "settingsId"          uuid         NOT NULL,
        "no"                  integer      NOT NULL,
        "domainMr"            varchar(200) NOT NULL,
        "domainEn"            varchar(200) NOT NULL,
        "basicCertificate"    varchar(300) NOT NULL,
        "advancedCertificate" varchar(300) NOT NULL,
        "displayOrder"        integer      NOT NULL DEFAULT 0,
        CONSTRAINT "PK_programme_elective_domains" PRIMARY KEY ("id"),
        CONSTRAINT "FK_programme_elective_domains_settings" FOREIGN KEY ("settingsId") REFERENCES "programme_module_settings"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_programme_elective_domains_domain_mr" CHECK (btrim("domainMr") <> ''),
        CONSTRAINT "CHK_programme_elective_domains_domain_en" CHECK (btrim("domainEn") <> ''),
        /*
         * Both certificates are required on the same row. A candidate chooses the DOMAIN, and that
         * one choice decides the basic course in module 3 and the advanced course in module 4 — so
         * a domain that exists at only one level is not a thing the programme offers.
         */
        CONSTRAINT "CHK_programme_elective_domains_basic" CHECK (btrim("basicCertificate") <> ''),
        CONSTRAINT "CHK_programme_elective_domains_advanced" CHECK (btrim("advancedCertificate") <> ''),
        CONSTRAINT "CHK_programme_elective_domains_order" CHECK ("displayOrder" >= 0 AND "no" >= 0)
      )`);

    await q.query(
      `CREATE INDEX "IDX_programme_elective_domains_settingsId" ON "programme_elective_domains" ("settingsId")`,
    );

    for (const t of [
      'programme_module_settings',
      'programme_modules',
      'programme_elective_domains',
    ]) {
      await q.query(
        `CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`,
      );
    }
  }

  /* Children first: the foreign keys are RESTRICT. */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "programme_elective_domains"`);
    await q.query(`DROP TABLE IF EXISTS "programme_modules"`);
    await q.query(`DROP TABLE IF EXISTS "programme_module_settings"`);
  }
}
