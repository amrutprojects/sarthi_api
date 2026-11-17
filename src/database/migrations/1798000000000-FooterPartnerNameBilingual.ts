import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Footer: the implementation partner's name in Marathi and English.
 *
 * The name was one column, printed as written in both languages. It becomes a pair like the partner
 * label beside it: "partnerName" is renamed "partnerNameEn" and "partnerNameMr" is added.
 *
 * Every existing name is copied into "partnerNameMr", so the website prints exactly what it printed
 * before until an administrator writes the Marathi spelling. The two names known to be in use get
 * their Marathi spelling now; only exactly those values are matched.
 *
 * Both halves are required, as every other footer text pair is: the site has no per-field language
 * fallback, so a blank half would leave the partner line nameless for half the visitors.
 */
const KNOWN_MARATHI: [string, string][] = [
  ['SUMAGO INFOTECH PVT LTD', 'सुमागो इन्फोटेक प्रा. लि.'],
  ['COEP Technological University', 'सीओईपी तंत्रज्ञान विद्यापीठ'],
];

export class FooterPartnerNameBilingual1798000000000 implements MigrationInterface {
  name = 'FooterPartnerNameBilingual1798000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "footer_settings" DROP CONSTRAINT "CHK_footer_settings_partner_name"`);
    await q.query(`ALTER TABLE "footer_settings" RENAME COLUMN "partnerName" TO "partnerNameEn"`);
    await q.query(`ALTER TABLE "footer_settings" ADD COLUMN "partnerNameMr" varchar(150) NULL`);

    await q.query(`UPDATE "footer_settings" SET "partnerNameMr" = "partnerNameEn"`);
    for (const [en, mr] of KNOWN_MARATHI) {
      await q.query(`UPDATE "footer_settings" SET "partnerNameMr" = $2 WHERE "partnerNameEn" = $1`, [en, mr]);
    }

    await q.query(`ALTER TABLE "footer_settings" ALTER COLUMN "partnerNameMr" SET NOT NULL`);
    await q.query(
      `ALTER TABLE "footer_settings" ADD CONSTRAINT "CHK_footer_settings_partner_name_mr" CHECK (btrim("partnerNameMr") <> '')`,
    );
    await q.query(
      `ALTER TABLE "footer_settings" ADD CONSTRAINT "CHK_footer_settings_partner_name_en" CHECK (btrim("partnerNameEn") <> '')`,
    );
  }

  /* The Marathi name is dropped; the English name stays as the single name. */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "footer_settings" DROP CONSTRAINT "CHK_footer_settings_partner_name_en"`);
    await q.query(`ALTER TABLE "footer_settings" DROP CONSTRAINT "CHK_footer_settings_partner_name_mr"`);
    await q.query(`ALTER TABLE "footer_settings" DROP COLUMN "partnerNameMr"`);
    await q.query(`ALTER TABLE "footer_settings" RENAME COLUMN "partnerNameEn" TO "partnerName"`);
    await q.query(
      `ALTER TABLE "footer_settings" ADD CONSTRAINT "CHK_footer_settings_partner_name" CHECK (btrim("partnerName") <> '')`,
    );
  }
}
