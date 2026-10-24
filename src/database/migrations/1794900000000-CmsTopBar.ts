import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * CMS: "Top Bar" — the strip at the very top of every website page: the bold government name, the
 * links beside it ("Verify Certificate", "Check Application Status") and the Marathi / English switch.
 *
 * Two tables. The links are a list an administrator adds to, edits, reorders, hides and deletes, one
 * row each, with no fixed number. The government name and whether the language switch is shown are
 * single-valued and live in a singleton settings row.
 *
 * A link's label is never blank in either language. The government name is optional: blank in both
 * languages (the bold text is left out) or filled in both. A link's `link` lands in an href on every
 * page, so the CHECK below admits only a page of this site ('/verify', never '//host') or an absolute
 * http(s) address — never `javascript:` or `data:` — the same rule as the other CMS links. Unlike a
 * card, a Top Bar link without a destination is meaningless, so the column is NOT NULL.
 *
 * Creates tables only; no existing table or row is touched. The initial content — the strip the
 * website showed — is written by the seed (seed-top-bar.ts), like the other CMS sections.
 */
export class CmsTopBar1794900000000 implements MigrationInterface {
  name = 'CmsTopBar1794900000000';

  public async up(q: QueryRunner): Promise<void> {
    const base = `
      "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "isDelete"  boolean     NOT NULL DEFAULT false,
      "isActive"  boolean     NOT NULL DEFAULT true`;

    const pair = (table: string, name: string, col: string) =>
      `CONSTRAINT "CHK_${table}_${name}_pair" CHECK ((btrim("${col}Mr") = '') = (btrim("${col}En") = ''))`;
    const filled = (table: string, name: string, col: string) =>
      `CONSTRAINT "CHK_${table}_${name}_mr" CHECK (btrim("${col}Mr") <> ''),
       CONSTRAINT "CHK_${table}_${name}_en" CHECK (btrim("${col}En") <> '')`;

    await q.query(`
      CREATE TABLE "top_bar_settings" (${base},
        "governmentNameMr"   varchar(80) NOT NULL DEFAULT '',
        "governmentNameEn"   varchar(80) NOT NULL DEFAULT '',
        "showLanguageToggle" boolean     NOT NULL DEFAULT true,
        CONSTRAINT "PK_top_bar_settings" PRIMARY KEY ("id"),
        ${pair('top_bar_settings', 'governmentName', 'governmentName')}
      )`);

    /* A singleton, the same way the other CMS sections are: one live configuration, ever. */
    await q.query(`CREATE UNIQUE INDEX "UQ_top_bar_settings_singleton" ON "top_bar_settings" ((true)) WHERE "isDelete" = false`);

    await q.query(`
      CREATE TABLE "top_bar_links" (${base},
        "labelMr"      varchar(40)  NOT NULL,
        "labelEn"      varchar(40)  NOT NULL,
        "link"         varchar(500) NOT NULL,
        "displayOrder" integer      NOT NULL DEFAULT 0,
        CONSTRAINT "PK_top_bar_links" PRIMARY KEY ("id"),
        ${filled('top_bar_links', 'label', 'label')},
        CONSTRAINT "CHK_top_bar_links_link" CHECK (
          ("link" ~ '^/[A-Za-z0-9._~/?=&%#-]*$' AND "link" !~ '^//')
          OR "link" ~ '^https?://[^[:space:]<>"]+$'
        ),
        CONSTRAINT "CHK_top_bar_links_order" CHECK ("displayOrder" >= 0)
      )`);

    for (const t of ['top_bar_settings', 'top_bar_links']) {
      await q.query(`CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "top_bar_links"`);
    await q.query(`DROP TABLE IF EXISTS "top_bar_settings"`);
  }
}
