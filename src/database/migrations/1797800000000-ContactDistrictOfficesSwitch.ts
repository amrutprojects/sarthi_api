import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Contact Page Management: a "Show on website" switch for the Contact page's "District offices" section (the list of
 * every district, each linking to its District Office page).
 *
 * One boolean on the contact_page_settings singleton, shown by default, so the website looks exactly as it did until
 * an administrator hides the section. Adds a column only; no existing row or value changes.
 */
export class ContactDistrictOfficesSwitch1797800000000 implements MigrationInterface {
  name = 'ContactDistrictOfficesSwitch1797800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "contact_page_settings" ADD COLUMN "showDistrictOffices" boolean NOT NULL DEFAULT true`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "contact_page_settings" DROP COLUMN IF EXISTS "showDistrictOffices"`);
  }
}
