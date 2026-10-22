import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * CMS: "AMRUT's Impact" — the अमृतचा प्रभाव band of headline figures on the home page.
 *
 * Two tables. The statistic cards are a list an administrator adds to, edits, reorders, hides and
 * deletes, one row each, with no fixed number of cards. The section's heading and visibility are
 * single-valued and live in a singleton settings row.
 *
 * A card's `value` is text ('1,000+', '36'), printed exactly as entered; it is never blank. Every
 * figure is entered by hand — nothing derives one from another table.
 *
 * Creates tables only; no existing table or row is touched. The initial content — the four figures
 * the website showed — is written by the seed (seed-amrut-impact.ts), like the other CMS sections.
 */
export class CmsAmrutImpact1794500000000 implements MigrationInterface {
  name = 'CmsAmrutImpact1794500000000';

  public async up(q: QueryRunner): Promise<void> {
    const base = `
      "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "isDelete"  boolean     NOT NULL DEFAULT false,
      "isActive"  boolean     NOT NULL DEFAULT true`;

    const filled = (table: string, name: string, col: string) =>
      `CONSTRAINT "CHK_${table}_${name}_mr" CHECK (btrim("${col}Mr") <> ''),
       CONSTRAINT "CHK_${table}_${name}_en" CHECK (btrim("${col}En") <> '')`;

    await q.query(`
      CREATE TABLE "impact_section" (${base},
        "headingMr"   varchar(120) NOT NULL,
        "headingEn"   varchar(120) NOT NULL,
        "showSection" boolean      NOT NULL DEFAULT true,
        CONSTRAINT "PK_impact_section" PRIMARY KEY ("id"),
        ${filled('impact_section', 'heading', 'heading')}
      )`);

    /* A singleton, the same way the other CMS sections are: one live configuration, ever. */
    await q.query(`CREATE UNIQUE INDEX "UQ_impact_section_singleton" ON "impact_section" ((true)) WHERE "isDelete" = false`);

    await q.query(`
      CREATE TABLE "impact_stats" (${base},
        "value"        varchar(20) NOT NULL,
        "labelMr"      varchar(80) NOT NULL,
        "labelEn"      varchar(80) NOT NULL,
        "displayOrder" integer     NOT NULL,
        CONSTRAINT "PK_impact_stats" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_impact_stats_value" CHECK (btrim("value") <> ''),
        ${filled('impact_stats', 'label', 'label')},
        CONSTRAINT "CHK_impact_stats_order" CHECK ("displayOrder" BETWEEN 1 AND 999)
      )`);

    for (const t of ['impact_section', 'impact_stats']) {
      await q.query(`CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "impact_stats"`);
    await q.query(`DROP TABLE IF EXISTS "impact_section"`);
  }
}
