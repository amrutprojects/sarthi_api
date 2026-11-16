import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Home Page Management: one "Show on website" switch per tab (src/cms/visibility).
 *
 * Most sections already had their switch — `showSection` on the Announcements, Impact, Ecosystem,
 * Schemes and About rows, and `isPublished` on the hero and the programme band. Four tabs had none:
 * the Top Bar, the Brand Bar and the Leadership & Governing Board get `showSection`, and the
 * "Programme at a glance" card gets `showGlance` on the hero row it is drawn inside (it owns no row
 * of its own, and its tab is under the same cms-hero menu).
 *
 * Every column defaults to true, so every existing row stays exactly as visible as it is today.
 * Columns only; no row is rewritten, so no "updatedAt" changes.
 */
export class SectionVisibility1796300000000 implements MigrationInterface {
  name = 'SectionVisibility1796300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "top_bar_settings" ADD COLUMN "showSection" boolean NOT NULL DEFAULT true`);
    await q.query(`ALTER TABLE "brand_bar_settings" ADD COLUMN "showSection" boolean NOT NULL DEFAULT true`);
    await q.query(`ALTER TABLE "board_section" ADD COLUMN "showSection" boolean NOT NULL DEFAULT true`);
    await q.query(`ALTER TABLE "home_hero" ADD COLUMN "showGlance" boolean NOT NULL DEFAULT true`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "home_hero" DROP COLUMN "showGlance"`);
    await q.query(`ALTER TABLE "board_section" DROP COLUMN "showSection"`);
    await q.query(`ALTER TABLE "brand_bar_settings" DROP COLUMN "showSection"`);
    await q.query(`ALTER TABLE "top_bar_settings" DROP COLUMN "showSection"`);
  }
}
