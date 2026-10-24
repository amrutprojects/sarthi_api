import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * CMS: the "About AMRUT" section (अमृत विषयी माहिती) of the home page, whose profile card and
 * Mission / Vision / Values cards the About page shows too.
 *
 * Three tables:
 * - about_section  a singleton: the heading, optional subtitle, the main description and visibility;
 * - about_facts    the rows of the information card (Established, Registration, Headquarters, …) —
 *                  label and value, any number of them, in display order;
 * - about_cards    the cards beside it (Our Mission, Our Vision, Our Values, …), any number of them.
 *
 * The three original cards are marked "isRequired": an administrator can edit and reorder them but
 * never delete or hide them. The CHECKs below hold that whatever writes to the table.
 *
 * Labels (rows) and headings (cards) are unique per language, ignoring case, among the records that
 * are not deleted — two "Established" rows would be a mistake, and it also stops a double-submitted
 * form from adding the same record twice.
 *
 * Creates tables only; no existing table or row is touched. The initial content is written by the
 * seed (seed-about-amrut.ts), like the other CMS sections.
 */
export class CmsAboutAmrut1794400000000 implements MigrationInterface {
  name = 'CmsAboutAmrut1794400000000';

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
      CREATE TABLE "about_section" (${base},
        "headingMr"     varchar(120)  NOT NULL,
        "headingEn"     varchar(120)  NOT NULL,
        "subtitleMr"    varchar(300)  NOT NULL DEFAULT '',
        "subtitleEn"    varchar(300)  NOT NULL DEFAULT '',
        "descriptionMr" varchar(4000) NOT NULL,
        "descriptionEn" varchar(4000) NOT NULL,
        "showSection"   boolean       NOT NULL DEFAULT true,
        CONSTRAINT "PK_about_section" PRIMARY KEY ("id"),
        ${filled('about_section', 'heading', 'heading')},
        ${filled('about_section', 'description', 'description')},
        CONSTRAINT "CHK_about_section_subtitle_pair" CHECK ((btrim("subtitleMr") = '') = (btrim("subtitleEn") = ''))
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_about_section_singleton" ON "about_section" ((true)) WHERE "isDelete" = false`);

    await q.query(`
      CREATE TABLE "about_facts" (${base},
        "labelMr"      varchar(80)  NOT NULL,
        "labelEn"      varchar(80)  NOT NULL,
        "valueMr"      varchar(500) NOT NULL,
        "valueEn"      varchar(500) NOT NULL,
        "displayOrder" integer      NOT NULL DEFAULT 0,
        CONSTRAINT "PK_about_facts" PRIMARY KEY ("id"),
        ${filled('about_facts', 'label', 'label')},
        ${filled('about_facts', 'value', 'value')},
        CONSTRAINT "CHK_about_facts_order" CHECK ("displayOrder" >= 0)
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_about_facts_label_mr" ON "about_facts" (lower("labelMr")) WHERE "isDelete" = false`);
    await q.query(`CREATE UNIQUE INDEX "UQ_about_facts_label_en" ON "about_facts" (lower("labelEn")) WHERE "isDelete" = false`);

    await q.query(`
      CREATE TABLE "about_cards" (${base},
        "headingMr"     varchar(80)   NOT NULL,
        "headingEn"     varchar(80)   NOT NULL,
        "descriptionMr" varchar(1000) NOT NULL,
        "descriptionEn" varchar(1000) NOT NULL,
        "displayOrder"  integer       NOT NULL DEFAULT 0,
        "isRequired"    boolean       NOT NULL DEFAULT false,
        CONSTRAINT "PK_about_cards" PRIMARY KEY ("id"),
        ${filled('about_cards', 'heading', 'heading')},
        ${filled('about_cards', 'description', 'description')},
        CONSTRAINT "CHK_about_cards_order" CHECK ("displayOrder" >= 0),
        CONSTRAINT "CHK_about_cards_required_kept" CHECK (NOT "isRequired" OR (NOT "isDelete" AND "isActive"))
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_about_cards_heading_mr" ON "about_cards" (lower("headingMr")) WHERE "isDelete" = false`);
    await q.query(`CREATE UNIQUE INDEX "UQ_about_cards_heading_en" ON "about_cards" (lower("headingEn")) WHERE "isDelete" = false`);

    for (const t of ['about_section', 'about_facts', 'about_cards']) {
      await q.query(`CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "about_cards"`);
    await q.query(`DROP TABLE IF EXISTS "about_facts"`);
    await q.query(`DROP TABLE IF EXISTS "about_section"`);
  }
}
