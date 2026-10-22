import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * CMS: the home page's hero — the rotating banner at the top of the page.
 *
 * Two tables, because the slides are a list an administrator adds to, reorders and hides, and the
 * rest is single-valued: the labels of the two buttons printed on every slide ("Learn more" and
 * "Check Application Status") and the publish switch. Those labels are the hero's own copies; the
 * website prints the same words elsewhere from its global strings, which this does not touch.
 *
 * NOT here: the "Programme at a glance" card beside the banner. Its figures come from the Modules
 * and Programme page content, so storing them again would be a second place for them to disagree.
 *
 * A slide's link is a page of this site ('/apply'), never a full URL. It lands in an href on the
 * home page, so the CHECK below keeps `javascript:`, `data:`, other sites and protocol-relative
 * '//host' links out of the table whatever writes to it.
 *
 * Bilingual columns. The public site defaults to Marathi and renders all of this through bi().
 *
 * Creates tables only; no existing table or row is touched.
 */
export class CmsHomeHero1794000000000 implements MigrationInterface {
  name = 'CmsHomeHero1794000000000';

  public async up(q: QueryRunner): Promise<void> {
    const base = `
      "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "isDelete"  boolean     NOT NULL DEFAULT false,
      "isActive"  boolean     NOT NULL DEFAULT true`;

    await q.query(`
      CREATE TABLE "home_hero" (${base},
        "readMoreLabelMr"    varchar(60) NOT NULL,
        "readMoreLabelEn"    varchar(60) NOT NULL,
        "checkStatusLabelMr" varchar(60) NOT NULL,
        "checkStatusLabelEn" varchar(60) NOT NULL,
        "isPublished"        boolean     NOT NULL DEFAULT true,
        CONSTRAINT "PK_home_hero" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_home_hero_read_more_mr" CHECK (btrim("readMoreLabelMr") <> ''),
        CONSTRAINT "CHK_home_hero_read_more_en" CHECK (btrim("readMoreLabelEn") <> ''),
        CONSTRAINT "CHK_home_hero_check_status_mr" CHECK (btrim("checkStatusLabelMr") <> ''),
        CONSTRAINT "CHK_home_hero_check_status_en" CHECK (btrim("checkStatusLabelEn") <> '')
      )`);

    /* A singleton, the same way the other CMS pages are: one live configuration, ever. */
    await q.query(`CREATE UNIQUE INDEX "UQ_home_hero_singleton" ON "home_hero" ((true)) WHERE "isDelete" = false`);

    await q.query(`
      CREATE TABLE "home_hero_slides" (${base},
        "heroId"        uuid         NOT NULL,
        "tagMr"         varchar(60)  NOT NULL,
        "tagEn"         varchar(60)  NOT NULL,
        "titleMr"       varchar(200) NOT NULL,
        "titleEn"       varchar(200) NOT NULL,
        "descriptionMr" varchar(400) NOT NULL,
        "descriptionEn" varchar(400) NOT NULL,
        "ctaLabelMr"    varchar(60)  NOT NULL,
        "ctaLabelEn"    varchar(60)  NOT NULL,
        "ctaLink"       varchar(200) NOT NULL,
        "displayOrder"  integer      NOT NULL DEFAULT 0,
        CONSTRAINT "PK_home_hero_slides" PRIMARY KEY ("id"),
        CONSTRAINT "FK_home_hero_slides_hero"
          FOREIGN KEY ("heroId") REFERENCES "home_hero"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_home_hero_slides_tag_mr" CHECK (btrim("tagMr") <> ''),
        CONSTRAINT "CHK_home_hero_slides_tag_en" CHECK (btrim("tagEn") <> ''),
        CONSTRAINT "CHK_home_hero_slides_title_mr" CHECK (btrim("titleMr") <> ''),
        CONSTRAINT "CHK_home_hero_slides_title_en" CHECK (btrim("titleEn") <> ''),
        CONSTRAINT "CHK_home_hero_slides_description_mr" CHECK (btrim("descriptionMr") <> ''),
        CONSTRAINT "CHK_home_hero_slides_description_en" CHECK (btrim("descriptionEn") <> ''),
        CONSTRAINT "CHK_home_hero_slides_cta_label_mr" CHECK (btrim("ctaLabelMr") <> ''),
        CONSTRAINT "CHK_home_hero_slides_cta_label_en" CHECK (btrim("ctaLabelEn") <> ''),
        CONSTRAINT "CHK_home_hero_slides_cta_link_blank" CHECK (btrim("ctaLink") <> ''),
        CONSTRAINT "CHK_home_hero_slides_cta_link" CHECK ("ctaLink" ~ '^/[A-Za-z0-9._~/?=&%#-]*$' AND "ctaLink" !~ '^//'),
        CONSTRAINT "CHK_home_hero_slides_order" CHECK ("displayOrder" >= 0)
      )`);

    await q.query(`CREATE INDEX "IDX_home_hero_slides_heroId" ON "home_hero_slides" ("heroId")`);

    for (const t of ['home_hero', 'home_hero_slides']) {
      await q.query(`CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
    }
  }

  /* Children first: the foreign key is RESTRICT. */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "home_hero_slides"`);
    await q.query(`DROP TABLE IF EXISTS "home_hero"`);
  }
}
