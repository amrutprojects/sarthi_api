import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * CMS: "AMRUT Schemes" — the अमृत योजना विभाग card grid of the home page.
 *
 * Two tables. The scheme cards are a list an administrator adds to, edits, reorders, hides and
 * deletes, one row each, with no fixed number of cards. The section's heading, subtitle, default
 * button label and visibility are single-valued and live in a singleton settings row.
 *
 * `deadline` is a DATE — a calendar day with no time or time zone — so '2027-03-31' is stored and
 * read back as exactly that day. It is optional (NULL: the scheme has no last date) and bounded to a
 * plausible range so a mistyped year cannot be stored.
 *
 * A scheme's `link` lands in an href on the home page, so the CHECK below admits only a page of this
 * site ('/programme', never '//host') or an absolute http(s) address — never `javascript:` or
 * `data:`. NULL is a card without a link (the site says that page is not available yet).
 *
 * A scheme's title is unique (per language, ignoring case) among the schemes that are not deleted,
 * which is also what stops a double-submitted form from adding the same scheme twice.
 *
 * Creates tables only; no existing table or row is touched. The initial content — the six schemes
 * the website showed — is written by the seed (seed-amrut-schemes.ts), like the other CMS sections.
 */
export class CmsAmrutSchemes1794300000000 implements MigrationInterface {
  name = 'CmsAmrutSchemes1794300000000';

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
      CREATE TABLE "amrut_schemes_section" (${base},
        "headingMr"     varchar(120) NOT NULL,
        "headingEn"     varchar(120) NOT NULL,
        "subtitleMr"    varchar(300) NOT NULL DEFAULT '',
        "subtitleEn"    varchar(300) NOT NULL DEFAULT '',
        "buttonLabelMr" varchar(60)  NOT NULL,
        "buttonLabelEn" varchar(60)  NOT NULL,
        "showSection"   boolean      NOT NULL DEFAULT true,
        CONSTRAINT "PK_amrut_schemes_section" PRIMARY KEY ("id"),
        ${filled('amrut_schemes_section', 'heading', 'heading')},
        ${pair('amrut_schemes_section', 'subtitle', 'subtitle')},
        ${filled('amrut_schemes_section', 'button_label', 'buttonLabel')}
      )`);

    /* A singleton, the same way the other CMS sections are: one live configuration, ever. */
    await q.query(`CREATE UNIQUE INDEX "UQ_amrut_schemes_section_singleton" ON "amrut_schemes_section" ((true)) WHERE "isDelete" = false`);

    await q.query(`
      CREATE TABLE "amrut_schemes" (${base},
        "titleMr"       varchar(150) NOT NULL,
        "titleEn"       varchar(150) NOT NULL,
        "descriptionMr" varchar(500) NOT NULL,
        "descriptionEn" varchar(500) NOT NULL,
        "badgeMr"       varchar(40)  NOT NULL DEFAULT '',
        "badgeEn"       varchar(40)  NOT NULL DEFAULT '',
        "deadline"      date         NULL,
        "link"          varchar(500) NULL,
        "buttonLabelMr" varchar(60)  NOT NULL DEFAULT '',
        "buttonLabelEn" varchar(60)  NOT NULL DEFAULT '',
        "featured"      boolean      NOT NULL DEFAULT false,
        "displayOrder"  integer      NOT NULL DEFAULT 0,
        CONSTRAINT "PK_amrut_schemes" PRIMARY KEY ("id"),
        ${filled('amrut_schemes', 'title', 'title')},
        ${filled('amrut_schemes', 'description', 'description')},
        ${pair('amrut_schemes', 'badge', 'badge')},
        ${pair('amrut_schemes', 'button_label', 'buttonLabel')},
        CONSTRAINT "CHK_amrut_schemes_deadline" CHECK ("deadline" IS NULL OR "deadline" BETWEEN DATE '2000-01-01' AND DATE '2100-12-31'),
        CONSTRAINT "CHK_amrut_schemes_link" CHECK (
          "link" IS NULL
          OR ("link" ~ '^/[A-Za-z0-9._~/?=&%#-]*$' AND "link" !~ '^//')
          OR "link" ~ '^https?://[^[:space:]<>"]+$'
        ),
        CONSTRAINT "CHK_amrut_schemes_order" CHECK ("displayOrder" >= 0)
      )`);

    await q.query(`CREATE UNIQUE INDEX "UQ_amrut_schemes_title_mr" ON "amrut_schemes" (lower("titleMr")) WHERE "isDelete" = false`);
    await q.query(`CREATE UNIQUE INDEX "UQ_amrut_schemes_title_en" ON "amrut_schemes" (lower("titleEn")) WHERE "isDelete" = false`);

    for (const t of ['amrut_schemes_section', 'amrut_schemes']) {
      await q.query(`CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "amrut_schemes"`);
    await q.query(`DROP TABLE IF EXISTS "amrut_schemes_section"`);
  }
}
