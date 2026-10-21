import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Give every module its own list of employment domains.
 *
 * The previous migration moved domains onto the module, but only the two elective modules had any
 * — the earlier page-level list was defined for them alone. Every module now carries its own list,
 * so the core modules (ECS, ITS) are backfilled with the same domains.
 *
 * The certificate for a backfilled row is THE MODULE'S OWN certificate name, because that is what a
 * candidate actually earns there: a core module is identical for everyone whichever domain they are
 * following. No per-domain course names were invented for them; if the programme later publishes
 * some, an administrator edits them in the panel.
 *
 * Only modules with NO live domains are touched, so this cannot duplicate rows on a database where
 * an administrator has already filled them in, and re-running it is a no-op. It brings an existing
 * database in line with what seed-modules-page.ts now produces on a fresh install.
 */
export class DomainsForAllModules1793100000000 implements MigrationInterface {
  name = 'DomainsForAllModules1793100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      WITH
      /* The module whose list is copied: the first one that actually has domains. */
      source AS (
        SELECT m."id", m."settingsId"
        FROM "programme_modules" m
        WHERE m."isDelete" = false
          AND EXISTS (
            SELECT 1 FROM "programme_elective_domains" d
            WHERE d."moduleId" = m."id" AND d."isDelete" = false
          )
        ORDER BY m."displayOrder", m."no"
        LIMIT 1
      ),
      /* Modules that have none yet, and so are safe to fill. */
      target AS (
        SELECT m."id", m."nameEn", m."settingsId"
        FROM "programme_modules" m
        WHERE m."isDelete" = false
          AND NOT EXISTS (
            SELECT 1 FROM "programme_elective_domains" d
            WHERE d."moduleId" = m."id" AND d."isDelete" = false
          )
      )
      INSERT INTO "programme_elective_domains"
        ("moduleId", "no", "domainMr", "domainEn", "certificate", "displayOrder", "isActive", "isDelete")
      SELECT t."id", d."no", d."domainMr", d."domainEn", t."nameEn", d."displayOrder", true, false
      FROM target t
      JOIN source s ON s."settingsId" = t."settingsId"
      JOIN "programme_elective_domains" d
        ON d."moduleId" = s."id" AND d."isDelete" = false
    `);
  }

  /*
   * Removes only what this migration could have added: a module's domains where every certificate
   * on them is that module's own name. A list an administrator has since edited no longer matches
   * that shape and is left alone — reverting a backfill must not delete real work.
   */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DELETE FROM "programme_elective_domains" d
      USING "programme_modules" m
      WHERE m."id" = d."moduleId"
        AND d."certificate" = m."nameEn"
        AND NOT EXISTS (
          SELECT 1 FROM "programme_elective_domains" x
          WHERE x."moduleId" = m."id" AND x."isDelete" = false AND x."certificate" <> m."nameEn"
        )
    `);
  }
}
