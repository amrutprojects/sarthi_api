import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * CMS: "Brand Bar" — the bar under the Top Bar on every website page: the programme's title
 * ("AMRUT KALASH"), the organisation's full name in Marathi and English, and the implementation
 * partner ("Implementation Partner" / "SUMAGO INFOTECH PVT LTD").
 *
 * One singleton table. The title is never blank. The two full-name lines are separate lines of the
 * bar, so either may be blank on its own. The partner label is blank in both languages or filled in
 * both; a blank partner name leaves the partner block out.
 *
 * Creates a table only; no existing table or row is touched. The initial content — the bar the
 * website showed — is written by the seed (seed-brand-bar.ts), like the other CMS sections.
 */
export class CmsBrandBar1795900000000 implements MigrationInterface {
  name = 'CmsBrandBar1795900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "brand_bar_settings" (
        "id"             uuid         NOT NULL DEFAULT gen_random_uuid(),
        "createdAt"      timestamptz  NOT NULL DEFAULT now(),
        "updatedAt"      timestamptz  NOT NULL DEFAULT now(),
        "isDelete"       boolean      NOT NULL DEFAULT false,
        "isActive"       boolean      NOT NULL DEFAULT true,
        "title"          varchar(60)  NOT NULL,
        "fullNameMr"     varchar(160) NOT NULL DEFAULT '',
        "fullNameEn"     varchar(160) NOT NULL DEFAULT '',
        "partnerLabelMr" varchar(60)  NOT NULL DEFAULT '',
        "partnerLabelEn" varchar(60)  NOT NULL DEFAULT '',
        "partnerName"    varchar(100) NOT NULL DEFAULT '',
        CONSTRAINT "PK_brand_bar_settings" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_brand_bar_settings_title" CHECK (btrim("title") <> ''),
        CONSTRAINT "CHK_brand_bar_settings_partnerLabel_pair" CHECK ((btrim("partnerLabelMr") = '') = (btrim("partnerLabelEn") = ''))
      )`);

    /* A singleton, the same way the other CMS sections are: one live configuration, ever. */
    await q.query(`CREATE UNIQUE INDEX "UQ_brand_bar_settings_singleton" ON "brand_bar_settings" ((true)) WHERE "isDelete" = false`);
    await q.query(
      `CREATE TRIGGER "TRG_brand_bar_settings_updated_at" BEFORE UPDATE ON "brand_bar_settings" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "brand_bar_settings"`);
  }
}
