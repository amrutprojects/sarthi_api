import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * CMS: "The AMRUT Ecosystem" — the अमृत प्रणाली card grid of the home and About pages.
 *
 * Two tables. The programme cards are a list an administrator adds to, edits, reorders, hides and
 * deletes, one row each, with no fixed number of cards. The section's heading, subtitle, default link
 * label and visibility are single-valued and live in a singleton settings row.
 *
 * A card's `link` lands in an href on the home page, so the CHECK below admits only a page of this
 * site ('/programme', never '//host') or an absolute http(s) address — never `javascript:` or
 * `data:`. NULL is a card without a link (the site says that page is not available yet). `icon` is a
 * short identifier from the website's icon set; the API checks it against the allowed list.
 *
 * A programme's name is unique (per language, ignoring case) among the cards that are not deleted,
 * which is also what stops a double-submitted form from adding the same card twice.
 *
 * Creates tables only; no existing table or row is touched. The initial content is written by the
 * seed (seed-ecosystem.ts), like the other CMS sections.
 */
export class CmsEcosystem1794200000000 implements MigrationInterface {
  name = 'CmsEcosystem1794200000000';

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
      CREATE TABLE "ecosystem_section" (${base},
        "headingMr"   varchar(120) NOT NULL,
        "headingEn"   varchar(120) NOT NULL,
        "subtitleMr"  varchar(300) NOT NULL DEFAULT '',
        "subtitleEn"  varchar(300) NOT NULL DEFAULT '',
        "linkLabelMr" varchar(60)  NOT NULL,
        "linkLabelEn" varchar(60)  NOT NULL,
        "showSection" boolean      NOT NULL DEFAULT true,
        CONSTRAINT "PK_ecosystem_section" PRIMARY KEY ("id"),
        ${filled('ecosystem_section', 'heading', 'heading')},
        ${pair('ecosystem_section', 'subtitle', 'subtitle')},
        ${filled('ecosystem_section', 'link_label', 'linkLabel')}
      )`);

    /* A singleton, the same way the other CMS sections are: one live configuration, ever. */
    await q.query(`CREATE UNIQUE INDEX "UQ_ecosystem_section_singleton" ON "ecosystem_section" ((true)) WHERE "isDelete" = false`);

    await q.query(`
      CREATE TABLE "ecosystem_programmes" (${base},
        "nameMr"        varchar(80)  NOT NULL,
        "nameEn"        varchar(80)  NOT NULL,
        "descriptionMr" varchar(200) NOT NULL,
        "descriptionEn" varchar(200) NOT NULL,
        "icon"          varchar(30)  NOT NULL,
        "link"          varchar(500) NULL,
        "linkLabelMr"   varchar(60)  NOT NULL DEFAULT '',
        "linkLabelEn"   varchar(60)  NOT NULL DEFAULT '',
        "displayOrder"  integer      NOT NULL DEFAULT 0,
        CONSTRAINT "PK_ecosystem_programmes" PRIMARY KEY ("id"),
        ${filled('ecosystem_programmes', 'name', 'name')},
        ${filled('ecosystem_programmes', 'description', 'description')},
        ${pair('ecosystem_programmes', 'link_label', 'linkLabel')},
        CONSTRAINT "CHK_ecosystem_programmes_icon" CHECK ("icon" ~ '^[A-Za-z][A-Za-z0-9]{0,29}$'),
        CONSTRAINT "CHK_ecosystem_programmes_link" CHECK (
          "link" IS NULL
          OR ("link" ~ '^/[A-Za-z0-9._~/?=&%#-]*$' AND "link" !~ '^//')
          OR "link" ~ '^https?://[^[:space:]<>"]+$'
        ),
        CONSTRAINT "CHK_ecosystem_programmes_order" CHECK ("displayOrder" >= 0)
      )`);

    await q.query(
      `CREATE UNIQUE INDEX "UQ_ecosystem_programmes_name_mr" ON "ecosystem_programmes" (lower("nameMr")) WHERE "isDelete" = false`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_ecosystem_programmes_name_en" ON "ecosystem_programmes" (lower("nameEn")) WHERE "isDelete" = false`,
    );

    for (const t of ['ecosystem_section', 'ecosystem_programmes']) {
      await q.query(`CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "ecosystem_programmes"`);
    await q.query(`DROP TABLE IF EXISTS "ecosystem_section"`);
  }
}
