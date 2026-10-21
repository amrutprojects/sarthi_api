import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * CMS Footer content: footer_settings (the single-valued text, one row), footer_sections (the
 * columns that hold links) and footer_links (the lines inside them).
 *
 * Follows the conventions of the earlier migrations: the common columns, RESTRICT foreign keys,
 * partial unique indexes over non-deleted rows, and the set_updated_at trigger.
 *
 * Bilingual columns. The public site defaults to Marathi (useLang.tsx) and renders every one of
 * these strings through bi(), so a single-language column would leave the default view showing
 * either English text or nothing at all. Language-neutral values — email, phone, the partner's
 * registered name — stay single-valued.
 *
 * Three tables rather than one wide row because the brief asks for links and sections to be added
 * and removed, and for each to carry its own order and status. The About and Contact columns are
 * fixed parts of the layout and so live on the settings row; only the two middle columns are
 * list-shaped.
 *
 * Creates tables only; no existing table or row is touched.
 */
export class CmsFooter1792800000000 implements MigrationInterface {
  name = 'CmsFooter1792800000000';

  public async up(q: QueryRunner): Promise<void> {
    const base = `
      "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "isDelete"  boolean     NOT NULL DEFAULT false,
      "isActive"  boolean     NOT NULL DEFAULT true`;

    await q.query(`
      CREATE TABLE "footer_settings" (${base},
        "aboutHeadingMr"   varchar(200) NOT NULL,
        "aboutHeadingEn"   varchar(200) NOT NULL,
        "aboutBodyMr"      text         NOT NULL,
        "aboutBodyEn"      text         NOT NULL,
        "partnerLabelMr"   varchar(120) NOT NULL,
        "partnerLabelEn"   varchar(120) NOT NULL,
        "partnerName"      varchar(150) NOT NULL,
        "contactHeadingMr" varchar(200) NOT NULL,
        "contactHeadingEn" varchar(200) NOT NULL,
        "contactAddressMr" varchar(500) NOT NULL,
        "contactAddressEn" varchar(500) NOT NULL,
        "contactEmail"     varchar(255) NOT NULL,
        "contactPhone"     varchar(32)  NOT NULL,
        "copyrightMr"      varchar(300) NOT NULL,
        "copyrightEn"      varchar(300) NOT NULL,
        "disclaimerMr"     varchar(400) NOT NULL,
        "disclaimerEn"     varchar(400) NOT NULL,
        "isPublished"      boolean      NOT NULL DEFAULT true,
        CONSTRAINT "PK_footer_settings" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_footer_settings_about_heading_mr" CHECK (btrim("aboutHeadingMr") <> ''),
        CONSTRAINT "CHK_footer_settings_about_heading_en" CHECK (btrim("aboutHeadingEn") <> ''),
        CONSTRAINT "CHK_footer_settings_partner_name" CHECK (btrim("partnerName") <> ''),
        CONSTRAINT "CHK_footer_settings_email" CHECK ("contactEmail" = lower("contactEmail"))
      )`);

    /*
     * The footer is a singleton: one live configuration, ever. A unique index on a constant
     * expression is the standard PostgreSQL way to say that — it admits exactly one non-deleted
     * row, so a concurrent second INSERT fails at the database rather than silently creating a
     * rival configuration that the public endpoint might pick instead.
     */
    await q.query(`CREATE UNIQUE INDEX "UQ_footer_settings_singleton" ON "footer_settings" ((true)) WHERE "isDelete" = false`);

    await q.query(`
      CREATE TABLE "footer_sections" (${base},
        "settingsId"   uuid         NOT NULL,
        "kind"         varchar(32)  NOT NULL,
        "headingMr"    varchar(200) NULL,
        "headingEn"    varchar(200) NULL,
        "displayOrder" integer      NOT NULL DEFAULT 0,
        CONSTRAINT "PK_footer_sections" PRIMARY KEY ("id"),
        CONSTRAINT "FK_footer_sections_settings" FOREIGN KEY ("settingsId") REFERENCES "footer_settings"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_footer_sections_kind" CHECK ("kind" IN ('LINK_COLUMN', 'CONTACT')),
        CONSTRAINT "CHK_footer_sections_order" CHECK ("displayOrder" >= 0),
        /*
         * A link column is a column on the page and must be titled. The CONTACT row is not a column
         * of its own — it exists only to own the extra lines beneath the phone number, and takes
         * its heading from footer_settings — so it carries no heading at all.
         */
        CONSTRAINT "CHK_footer_sections_heading_by_kind" CHECK (
          ("kind" = 'LINK_COLUMN' AND "headingMr" IS NOT NULL AND "headingEn" IS NOT NULL)
          OR
          ("kind" = 'CONTACT' AND "headingMr" IS NULL AND "headingEn" IS NULL)
        )
      )`);

    /* One live CONTACT row per footer. Link columns are positional, so they are not constrained. */
    await q.query(
      `CREATE UNIQUE INDEX "UQ_footer_sections_contact_singleton" ON "footer_sections" ("settingsId") WHERE "isDelete" = false AND "kind" = 'CONTACT'`,
    );
    await q.query(`CREATE INDEX "IDX_footer_sections_settingsId" ON "footer_sections" ("settingsId")`);

    await q.query(`
      CREATE TABLE "footer_links" (${base},
        "sectionId"    uuid         NOT NULL,
        "kind"         varchar(32)  NOT NULL,
        "labelMr"      varchar(150) NOT NULL,
        "labelEn"      varchar(150) NOT NULL,
        "href"         varchar(500) NULL,
        "displayOrder" integer      NOT NULL DEFAULT 0,
        CONSTRAINT "PK_footer_links" PRIMARY KEY ("id"),
        CONSTRAINT "FK_footer_links_section" FOREIGN KEY ("sectionId") REFERENCES "footer_sections"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_footer_links_kind" CHECK ("kind" IN ('INTERNAL', 'EXTERNAL', 'TEXT', 'UNAVAILABLE')),
        CONSTRAINT "CHK_footer_links_label_mr" CHECK (btrim("labelMr") <> ''),
        CONSTRAINT "CHK_footer_links_label_en" CHECK (btrim("labelEn") <> ''),
        CONSTRAINT "CHK_footer_links_order" CHECK ("displayOrder" >= 0),
        /*
         * The href rule, enforced at the table so a hostile or malformed URL cannot be stored even
         * if a service check is ever missed. These values reach an href attribute on every page of
         * the public site:
         *   INTERNAL    — a path on this site; '//host' is excluded, the browser reads it as
         *                 protocol-relative and would leave the site
         *   EXTERNAL    — absolute http(s) only, which rules out javascript: and data:
         *   TEXT /
         *   UNAVAILABLE — no destination at all, so no href may be parked on the row and later
         *                 activated by switching the kind
         */
        CONSTRAINT "CHK_footer_links_href_by_kind" CHECK (
          ("kind" = 'INTERNAL' AND "href" ~ '^/' AND "href" !~ '^//')
          OR
          ("kind" = 'EXTERNAL' AND "href" ~ '^https?://')
          OR
          ("kind" IN ('TEXT', 'UNAVAILABLE') AND "href" IS NULL)
        )
      )`);

    await q.query(`CREATE INDEX "IDX_footer_links_sectionId" ON "footer_links" ("sectionId")`);

    for (const t of ['footer_settings', 'footer_sections', 'footer_links']) {
      await q.query(`CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
    }
  }

  /* Children first: the foreign keys are RESTRICT. */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "footer_links"`);
    await q.query(`DROP TABLE IF EXISTS "footer_sections"`);
    await q.query(`DROP TABLE IF EXISTS "footer_settings"`);
  }
}
