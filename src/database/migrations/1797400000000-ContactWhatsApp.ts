import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Contact Page Management: the website's WhatsApp button reads its number and pre-filled message from
 * the Contact page settings, so they are edited in the same place as the phone and email the Helpline
 * popup prints, and the two can no longer disagree.
 *
 * contact_page_settings gains:
 *   "whatsappNumber"    digits only, country code included (e.g. 919730151450). Blank: the website uses
 *                       the AMRUT card's phone number.
 *   "whatsappMessageMr" / "whatsappMessageEn"  the message typed into the chat for the visitor. Blank in
 *                       both: the website's default message. The CHECK keeps the pair filled in both
 *                       languages or in neither, since the site has no per-language fallback.
 *
 * Defaults to blank, so the button keeps today's number (the AMRUT phone is that number) and message.
 * Columns only; no row is rewritten, so no "updatedAt" changes.
 */
export class ContactWhatsApp1797400000000 implements MigrationInterface {
  name = 'ContactWhatsApp1797400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "contact_page_settings"
        ADD COLUMN "whatsappNumber" varchar(15) NOT NULL DEFAULT '',
        ADD COLUMN "whatsappMessageMr" varchar(500) NOT NULL DEFAULT '',
        ADD COLUMN "whatsappMessageEn" varchar(500) NOT NULL DEFAULT '',
        ADD CONSTRAINT "CHK_contact_page_settings_whatsapp_number" CHECK ("whatsappNumber" = '' OR "whatsappNumber" ~ '^[0-9]{10,15}$'),
        ADD CONSTRAINT "CHK_contact_page_settings_whatsapp_message_pair"
          CHECK ((btrim("whatsappMessageMr") = '') = (btrim("whatsappMessageEn") = ''))`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "contact_page_settings"
        DROP CONSTRAINT IF EXISTS "CHK_contact_page_settings_whatsapp_message_pair",
        DROP CONSTRAINT IF EXISTS "CHK_contact_page_settings_whatsapp_number",
        DROP COLUMN "whatsappMessageEn",
        DROP COLUMN "whatsappMessageMr",
        DROP COLUMN "whatsappNumber"`);
  }
}
