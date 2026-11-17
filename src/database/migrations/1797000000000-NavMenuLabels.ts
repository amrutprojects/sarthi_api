import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Navigation Menu: the name of each item of the website's menu bar (and of its Login / Register button)
 * can be edited from the CMS, in Marathi and English.
 *
 * nav_menu_items gains "labelMr" and "labelEn". Blank means "use the website's own default name"; the
 * CHECK keeps the pair filled in both languages or in neither, since the site has no per-language
 * fallback.
 *
 * Defaults to blank, so every item keeps its current name exactly as today. Columns only; no row is
 * rewritten, so no "updatedAt" changes.
 */
export class NavMenuLabels1797000000000 implements MigrationInterface {
  name = 'NavMenuLabels1797000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "nav_menu_items"
        ADD COLUMN "labelMr" varchar(40) NOT NULL DEFAULT '',
        ADD COLUMN "labelEn" varchar(40) NOT NULL DEFAULT '',
        ADD CONSTRAINT "CHK_nav_menu_items_label_pair" CHECK ((btrim("labelMr") = '') = (btrim("labelEn") = ''))`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "nav_menu_items"
        DROP CONSTRAINT IF EXISTS "CHK_nav_menu_items_label_pair",
        DROP COLUMN "labelEn",
        DROP COLUMN "labelMr"`);
  }
}
