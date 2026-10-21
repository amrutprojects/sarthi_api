import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * CMS Contact page content: contact_page_settings (the banner, one row) and contact_organizations
 * (the cards shown on it).
 *
 * Follows the conventions of the earlier migrations: the common columns, RESTRICT foreign keys,
 * partial unique indexes over non-deleted rows, and the set_updated_at trigger.
 *
 * Bilingual columns. The public site defaults to Marathi (useLang.tsx) and renders every one of
 * these strings through bi(), so a single-language column would leave the default view showing
 * either English text or nothing at all. Language-neutral values — email, phone, website — stay
 * single-valued.
 *
 * Two tables rather than one wide settings row, because the brief asks for additional cards to be
 * possible later and for per-card display order and status. The card TYPE decides which columns
 * apply, so the per-type requirements are enforced by a CHECK constraint rather than by NOT NULL.
 *
 * Creates tables only; no existing table or row is touched.
 */
export class CmsContactPage1792300000000 implements MigrationInterface {
  name = 'CmsContactPage1792300000000';

  public async up(q: QueryRunner): Promise<void> {
    const base = `
      "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "isDelete"  boolean     NOT NULL DEFAULT false,
      "isActive"  boolean     NOT NULL DEFAULT true`;

    await q.query(`
      CREATE TABLE "contact_page_settings" (${base},
        "pageTitleMr"    varchar(150) NOT NULL,
        "pageTitleEn"    varchar(150) NOT NULL,
        "pageSubtitleMr" varchar(300) NOT NULL,
        "pageSubtitleEn" varchar(300) NOT NULL,
        "isPublished"    boolean      NOT NULL DEFAULT true,
        CONSTRAINT "PK_contact_page_settings" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_contact_page_settings_title_mr" CHECK (btrim("pageTitleMr") <> ''),
        CONSTRAINT "CHK_contact_page_settings_title_en" CHECK (btrim("pageTitleEn") <> '')
      )`);

    /*
     * The Contact page is a singleton: one live configuration, ever. A unique index on a constant
     * expression is the standard PostgreSQL way to say that — it admits exactly one non-deleted row,
     * so a concurrent second INSERT fails at the database rather than silently creating a rival
     * configuration that the public endpoint might pick instead.
     */
    await q.query(`CREATE UNIQUE INDEX "UQ_contact_page_settings_singleton" ON "contact_page_settings" ((true)) WHERE "isDelete" = false`);

    await q.query(`
      CREATE TABLE "contact_organizations" (${base},
        "settingsId"       uuid         NOT NULL,
        "orgType"          varchar(32)  NOT NULL,
        "nameMr"           varchar(150) NOT NULL,
        "nameEn"           varchar(150) NOT NULL,
        "roleMr"           varchar(200) NULL,
        "roleEn"           varchar(200) NULL,
        "addressMr"        varchar(500) NULL,
        "addressEn"        varchar(500) NULL,
        "email"            varchar(255) NULL,
        "phone"            varchar(32)  NULL,
        "websiteUrl"       varchar(255) NULL,
        "helpdeskHoursMr"  varchar(120) NULL,
        "helpdeskHoursEn"  varchar(120) NULL,
        "displayOrder"     integer      NOT NULL DEFAULT 0,
        CONSTRAINT "PK_contact_organizations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_contact_organizations_settings" FOREIGN KEY ("settingsId") REFERENCES "contact_page_settings"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_contact_organizations_type" CHECK ("orgType" IN ('AMRUT', 'IMPLEMENTATION_PARTNER')),
        CONSTRAINT "CHK_contact_organizations_email" CHECK ("email" IS NULL OR "email" = lower("email")),
        CONSTRAINT "CHK_contact_organizations_website" CHECK ("websiteUrl" IS NULL OR "websiteUrl" ~ '^https?://'),
        CONSTRAINT "CHK_contact_organizations_order" CHECK ("displayOrder" >= 0),
        /*
         * Which columns a card must fill depends on the card. The AMRUT card shows a postal address,
         * an email and a phone number; the implementation partner shows a role, a desk email and its
         * helpdesk hours. Encoding that here means a malformed card cannot reach the table even if a
         * service-layer check is ever missed.
         */
        CONSTRAINT "CHK_contact_organizations_required_by_type" CHECK (
          ("orgType" = 'AMRUT'
            AND "addressMr" IS NOT NULL AND "addressEn" IS NOT NULL
            AND "email" IS NOT NULL AND "phone" IS NOT NULL)
          OR
          ("orgType" = 'IMPLEMENTATION_PARTNER'
            AND "roleMr" IS NOT NULL AND "roleEn" IS NOT NULL
            AND "email" IS NOT NULL
            AND "helpdeskHoursMr" IS NOT NULL AND "helpdeskHoursEn" IS NOT NULL)
        )
      )`);

    /* One live card of each type. Soft-deleted rows keep their history without blocking a new card. */
    await q.query(
      `CREATE UNIQUE INDEX "UQ_contact_organizations_type_active" ON "contact_organizations" ("settingsId", "orgType") WHERE "isDelete" = false`,
    );
    await q.query(`CREATE INDEX "IDX_contact_organizations_settingsId" ON "contact_organizations" ("settingsId")`);

    for (const t of ['contact_page_settings', 'contact_organizations']) {
      await q.query(`CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
    }
  }

  /* Children first: the foreign key is RESTRICT. */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "contact_organizations"`);
    await q.query(`DROP TABLE IF EXISTS "contact_page_settings"`);
  }
}
