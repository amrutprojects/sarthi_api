import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * CMS: "Page Banners" — the title and subtitle of the banner at the top of five website pages (About,
 * FAQ, Programme, Track application, Verify certificate), which were fixed in the website until now.
 *
 * One row per page, keyed by the website's fixed page key; the pages and their default words stay in
 * the website. At most one live row per key. The keys are written out here rather than imported, so
 * this migration stays what it was when it ran even if the list in the code changes later.
 *
 * Title and subtitle are each blank in both languages (the website's default) or filled in both; the
 * CHECKs keep a pair from being half-translated, since the site has no per-language fallback.
 *
 * The five rows are inserted here, all blank, so `migration:run` alone sets the screen up and every
 * banner stays exactly as it is today. No seed is needed: a page with no row reads as the default.
 */
const KEYS = ['about', 'faq', 'programme', 'track', 'verify'];

export class CmsPageBanners1797500000000 implements MigrationInterface {
  name = 'CmsPageBanners1797500000000';

  public async up(q: QueryRunner): Promise<void> {
    const keyList = KEYS.map((k) => `'${k}'`).join(', ');
    await q.query(`
      CREATE TABLE "page_banners" (
        "id"         uuid         NOT NULL DEFAULT gen_random_uuid(),
        "createdAt"  timestamptz  NOT NULL DEFAULT now(),
        "updatedAt"  timestamptz  NOT NULL DEFAULT now(),
        "isDelete"   boolean      NOT NULL DEFAULT false,
        "isActive"   boolean      NOT NULL DEFAULT true,
        "key"        varchar(20)  NOT NULL,
        "titleMr"    varchar(150) NOT NULL DEFAULT '',
        "titleEn"    varchar(150) NOT NULL DEFAULT '',
        "subtitleMr" varchar(300) NOT NULL DEFAULT '',
        "subtitleEn" varchar(300) NOT NULL DEFAULT '',
        CONSTRAINT "PK_page_banners" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_page_banners_key" CHECK ("key" IN (${keyList})),
        CONSTRAINT "CHK_page_banners_title_pair" CHECK ((btrim("titleMr") = '') = (btrim("titleEn") = '')),
        CONSTRAINT "CHK_page_banners_subtitle_pair" CHECK ((btrim("subtitleMr") = '') = (btrim("subtitleEn") = ''))
      )`);

    await q.query(`CREATE UNIQUE INDEX "UQ_page_banners_key_active" ON "page_banners" ("key") WHERE "isDelete" = false`);
    await q.query(
      `CREATE TRIGGER "TRG_page_banners_updated_at" BEFORE UPDATE ON "page_banners" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`,
    );

    await q.query(`INSERT INTO "page_banners" ("key") VALUES ${KEYS.map((_, i) => `($${i + 1})`).join(', ')}`, KEYS);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "page_banners"`);
  }
}
