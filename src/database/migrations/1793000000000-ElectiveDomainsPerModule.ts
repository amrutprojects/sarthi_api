import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Elective employment domains move from the page to the MODULE.
 *
 * They were first modelled as one list belonging to the settings row, each entry carrying two
 * certificate names — a basic one for module 3 and an advanced one for module 4. That encoded an
 * assumption the programme does not actually make: that both elective modules always offer exactly
 * the same domains.
 *
 * Each elective module now owns its own list, and a row carries ONE certificate — the award that
 * module gives in that domain. Module 3 and module 4 can offer different domains, and editing one
 * list leaves the other alone.
 *
 * Existing rows are carried over, not dropped: every domain becomes one row per elective module,
 * keeping the certificate that module awarded. With the seeded data that turns 10 rows into 20 —
 * the same ten domains under each of the two elective modules — so the public page is unchanged.
 */
export class ElectiveDomainsPerModule1793000000000 implements MigrationInterface {
  name = 'ElectiveDomainsPerModule1793000000000';

  public async up(q: QueryRunner): Promise<void> {
    /* The new shape, added nullable so the existing rows can be rewritten before it is enforced. */
    await q.query(`ALTER TABLE "programme_elective_domains" ADD COLUMN "moduleId" uuid NULL`);
    await q.query(`ALTER TABLE "programme_elective_domains" ADD COLUMN "certificate" varchar(300) NULL`);

    /*
     * Fan each existing domain out across the elective modules of its settings row.
     *
     * The FIRST elective module (by display order) keeps the basic certificate and the SECOND the
     * advanced one — the same pairing the two columns encoded. Ordering by displayOrder rather than
     * by code or number means this does not depend on what the modules happen to be called.
     */
    await q.query(`
      WITH ranked AS (
        SELECT m."id", m."settingsId",
               ROW_NUMBER() OVER (PARTITION BY m."settingsId" ORDER BY m."displayOrder", m."no") AS rn
        FROM "programme_modules" m
        WHERE m."isDelete" = false AND m."isElective" = true
      )
      INSERT INTO "programme_elective_domains"
        ("moduleId", "certificate", "no", "domainMr", "domainEn",
         /* Still NOT NULL at this point; both are dropped once the rewrite is done. */
         "settingsId", "basicCertificate", "advancedCertificate",
         "displayOrder", "isActive", "isDelete")
      SELECT r."id",
             CASE WHEN r.rn = 1 THEN d."basicCertificate" ELSE d."advancedCertificate" END,
             d."no", d."domainMr", d."domainEn",
             d."settingsId", d."basicCertificate", d."advancedCertificate",
             d."displayOrder", d."isActive", false
      FROM "programme_elective_domains" d
      JOIN ranked r ON r."settingsId" = d."settingsId"
      WHERE d."isDelete" = false AND d."moduleId" IS NULL
        /* Only the first two elective modules had a certificate column of their own. */
        AND r.rn <= 2
    `);

    /* The originals have been replaced by their per-module copies. */
    await q.query(`DELETE FROM "programme_elective_domains" WHERE "moduleId" IS NULL`);

    /* Now the new shape can be required. */
    await q.query(`ALTER TABLE "programme_elective_domains" ALTER COLUMN "moduleId" SET NOT NULL`);
    await q.query(`ALTER TABLE "programme_elective_domains" ALTER COLUMN "certificate" SET NOT NULL`);

    /* Out with the page-level shape. */
    await q.query(`ALTER TABLE "programme_elective_domains" DROP CONSTRAINT IF EXISTS "FK_programme_elective_domains_settings"`);
    await q.query(`ALTER TABLE "programme_elective_domains" DROP CONSTRAINT IF EXISTS "CHK_programme_elective_domains_basic"`);
    await q.query(`ALTER TABLE "programme_elective_domains" DROP CONSTRAINT IF EXISTS "CHK_programme_elective_domains_advanced"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_programme_elective_domains_settingsId"`);
    await q.query(`ALTER TABLE "programme_elective_domains" DROP COLUMN "settingsId"`);
    await q.query(`ALTER TABLE "programme_elective_domains" DROP COLUMN "basicCertificate"`);
    await q.query(`ALTER TABLE "programme_elective_domains" DROP COLUMN "advancedCertificate"`);

    await q.query(`
      ALTER TABLE "programme_elective_domains"
        ADD CONSTRAINT "FK_programme_elective_domains_module"
        FOREIGN KEY ("moduleId") REFERENCES "programme_modules"("id") ON DELETE RESTRICT`);
    await q.query(`
      ALTER TABLE "programme_elective_domains"
        ADD CONSTRAINT "CHK_programme_elective_domains_certificate" CHECK (btrim("certificate") <> '')`);

    await q.query(`CREATE INDEX "IDX_programme_elective_domains_moduleId" ON "programme_elective_domains" ("moduleId")`);
    /* A module cannot list the same number twice among its live domains. */
    await q.query(`
      CREATE UNIQUE INDEX "UQ_programme_elective_domains_module_no"
        ON "programme_elective_domains" ("moduleId", "no") WHERE "isDelete" = false`);
  }

  /*
   * Back to the page-level list.
   *
   * The two certificate columns are rebuilt by pairing each domain number across the two elective
   * modules. This is lossy where the modules have diverged — a domain only one of them offers comes
   * back with the other's certificate blank, which the old NOT NULL would reject, so those rows are
   * dropped rather than invented. That is the honest cost of reverting a widening change.
   */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "programme_elective_domains" ADD COLUMN "settingsId" uuid NULL`);
    await q.query(`ALTER TABLE "programme_elective_domains" ADD COLUMN "basicCertificate" varchar(300) NULL`);
    await q.query(`ALTER TABLE "programme_elective_domains" ADD COLUMN "advancedCertificate" varchar(300) NULL`);
    /* The rebuilt page-level rows belong to no module, so this has to give before they go in. */
    await q.query(`ALTER TABLE "programme_elective_domains" ALTER COLUMN "moduleId" DROP NOT NULL`);

    await q.query(`
      WITH ranked AS (
        SELECT m."id", m."settingsId",
               ROW_NUMBER() OVER (PARTITION BY m."settingsId" ORDER BY m."displayOrder", m."no") AS rn
        FROM "programme_modules" m
        WHERE m."isDelete" = false AND m."isElective" = true
      ),
      paired AS (
        SELECT r."settingsId", d."no",
               MAX(d."domainMr") AS "domainMr",
               MAX(d."domainEn") AS "domainEn",
               MAX(d."displayOrder") AS "displayOrder",
               MAX(CASE WHEN r.rn = 1 THEN d."certificate" END) AS basic,
               MAX(CASE WHEN r.rn = 2 THEN d."certificate" END) AS advanced
        FROM "programme_elective_domains" d
        JOIN ranked r ON r."id" = d."moduleId"
        WHERE d."isDelete" = false
        GROUP BY r."settingsId", d."no"
      )
      INSERT INTO "programme_elective_domains"
        ("settingsId", "basicCertificate", "advancedCertificate", "moduleId", "certificate",
         "no", "domainMr", "domainEn", "displayOrder", "isActive", "isDelete")
      SELECT p."settingsId", p.basic, p.advanced, NULL, '',
             p."no", p."domainMr", p."domainEn", p."displayOrder", true, false
      FROM paired p
      WHERE p.basic IS NOT NULL AND p.advanced IS NOT NULL
    `);

    await q.query(`DELETE FROM "programme_elective_domains" WHERE "settingsId" IS NULL`);

    await q.query(`DROP INDEX IF EXISTS "UQ_programme_elective_domains_module_no"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_programme_elective_domains_moduleId"`);
    await q.query(`ALTER TABLE "programme_elective_domains" DROP CONSTRAINT IF EXISTS "FK_programme_elective_domains_module"`);
    await q.query(`ALTER TABLE "programme_elective_domains" DROP CONSTRAINT IF EXISTS "CHK_programme_elective_domains_certificate"`);
    await q.query(`ALTER TABLE "programme_elective_domains" DROP COLUMN "moduleId"`);
    await q.query(`ALTER TABLE "programme_elective_domains" DROP COLUMN "certificate"`);

    await q.query(`ALTER TABLE "programme_elective_domains" ALTER COLUMN "settingsId" SET NOT NULL`);
    await q.query(`ALTER TABLE "programme_elective_domains" ALTER COLUMN "basicCertificate" SET NOT NULL`);
    await q.query(`ALTER TABLE "programme_elective_domains" ALTER COLUMN "advancedCertificate" SET NOT NULL`);

    await q.query(`
      ALTER TABLE "programme_elective_domains"
        ADD CONSTRAINT "FK_programme_elective_domains_settings"
        FOREIGN KEY ("settingsId") REFERENCES "programme_module_settings"("id") ON DELETE RESTRICT`);
    await q.query(`
      ALTER TABLE "programme_elective_domains"
        ADD CONSTRAINT "CHK_programme_elective_domains_basic" CHECK (btrim("basicCertificate") <> '')`);
    await q.query(`
      ALTER TABLE "programme_elective_domains"
        ADD CONSTRAINT "CHK_programme_elective_domains_advanced" CHECK (btrim("advancedCertificate") <> '')`);
    await q.query(`CREATE INDEX "IDX_programme_elective_domains_settingsId" ON "programme_elective_domains" ("settingsId")`);
  }
}
