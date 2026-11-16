import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Brand Bar: a switch for the "Implementation Partner" box on the right of the bar.
 *
 * brand_bar_settings gains "showPartner". Off, the website shows the bar without the partner box (the
 * public feed sends `partner: null`); the partner's label and name stay in the row, so an administrator
 * can turn the box back on without typing them again. It sits under the whole-bar switch ("showSection",
 * SectionVisibility1796300000000): a hidden bar hides its partner box too, whatever this says.
 *
 * Defaults to true, so the existing row stays exactly as visible as it is today. A column only; no row
 * is rewritten, so no "updatedAt" changes.
 */
export class BrandBarShowPartner1796500000000 implements MigrationInterface {
  name = 'BrandBarShowPartner1796500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "brand_bar_settings" ADD COLUMN "showPartner" boolean NOT NULL DEFAULT true`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "brand_bar_settings" DROP COLUMN "showPartner"`);
  }
}
