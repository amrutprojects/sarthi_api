import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Top Bar: a switch for Marathi numerals.
 *
 * With it on, the website prints every figure in Devanagari digits (०१२३४५६७८९) while a visitor reads it
 * in Marathi; off, it converts nothing and figures print exactly as written. It applies to the whole
 * site, not to the strip, and sits on top_bar_settings beside "showLanguageToggle" because that is where
 * the site's language options are configured. The whole-strip switch ("showSection") does not hide it:
 * the public feed always carries it.
 *
 * Defaults to true, so the existing row takes the Devanagari digits the website now prints by default.
 * A column only; no row is rewritten, so no "updatedAt" changes.
 */
export class TopBarMarathiNumerals1798100000000 implements MigrationInterface {
  name = 'TopBarMarathiNumerals1798100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "top_bar_settings" ADD COLUMN "marathiNumerals" boolean NOT NULL DEFAULT true`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "top_bar_settings" DROP COLUMN IF EXISTS "marathiNumerals"`);
  }
}
