import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Apply page: the small line under the Apply button becomes optional, and the seeded line is removed.
 *
 * The seed wrote "Opens in a new tab — app.mahaamrut.org.in" there. The website no longer prints it.
 * The two columns now accept blank text — a blank pair means "show nothing" — but never one half: the
 * pair CHECK keeps a half-translated line from being stored. Only exactly the seeded text is blanked, so
 * a hint an administrator wrote is never touched.
 */
export class ApplyCtaHintOptional1795100000000 implements MigrationInterface {
  name = 'ApplyCtaHintOptional1795100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "apply_page_settings" DROP CONSTRAINT "CHK_apply_page_settings_cta_hint_mr"`);
    await q.query(`ALTER TABLE "apply_page_settings" DROP CONSTRAINT "CHK_apply_page_settings_cta_hint_en"`);
    await q.query(`
      UPDATE "apply_page_settings" SET "ctaHintMr" = '', "ctaHintEn" = '', "updatedAt" = now()
      WHERE "ctaHintEn" = 'Opens in a new tab — app.mahaamrut.org.in'`);
    await q.query(`
      ALTER TABLE "apply_page_settings" ADD CONSTRAINT "CHK_apply_page_settings_cta_hint_pair"
      CHECK ((btrim("ctaHintMr") = '') = (btrim("ctaHintEn") = ''))`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "apply_page_settings" DROP CONSTRAINT "CHK_apply_page_settings_cta_hint_pair"`);
    await q.query(`
      UPDATE "apply_page_settings"
      SET "ctaHintMr" = 'ही लिंक नवीन टॅबमध्ये उघडेल — app.mahaamrut.org.in', "ctaHintEn" = 'Opens in a new tab — app.mahaamrut.org.in'
      WHERE btrim("ctaHintMr") = '' OR btrim("ctaHintEn") = ''`);
    await q.query(`ALTER TABLE "apply_page_settings" ADD CONSTRAINT "CHK_apply_page_settings_cta_hint_mr" CHECK (btrim("ctaHintMr") <> '')`);
    await q.query(`ALTER TABLE "apply_page_settings" ADD CONSTRAINT "CHK_apply_page_settings_cta_hint_en" CHECK (btrim("ctaHintEn") <> '')`);
  }
}
