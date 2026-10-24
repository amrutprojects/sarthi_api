import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Two more Contact page sections: the district / cluster coordinators and the per-district office
 * (Collectorate) details.
 *
 * - contact_coordinators           one coordinator card (name, phone, email)
 * - contact_coordinator_districts  the districts a coordinator covers; a district belongs to at most
 *                                  one coordinator (UQ on districtId), which is what lets the website
 *                                  answer "who is the coordinator for Pune?" without ambiguity
 * - contact_district_offices       Collectorate details, at most one live row per district
 *
 * Every Collectorate field is optional: the website prints "to be supplied from official records"
 * for whatever is still missing rather than inventing a value.
 *
 * Creates tables only; no existing table or row is touched.
 */
export class CmsContactCoordinatorsOffices1794100000000 implements MigrationInterface {
  name = 'CmsContactCoordinatorsOffices1794100000000';

  public async up(q: QueryRunner): Promise<void> {
    const base = `
      "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "isDelete"  boolean     NOT NULL DEFAULT false,
      "isActive"  boolean     NOT NULL DEFAULT true`;

    await q.query(`
      CREATE TABLE "contact_coordinators" (${base},
        "settingsId"   uuid         NOT NULL,
        "name"         varchar(120) NOT NULL,
        "phone"        varchar(32)  NOT NULL,
        "email"        varchar(255) NULL,
        "displayOrder" integer      NOT NULL DEFAULT 0,
        CONSTRAINT "PK_contact_coordinators" PRIMARY KEY ("id"),
        CONSTRAINT "FK_contact_coordinators_settings" FOREIGN KEY ("settingsId") REFERENCES "contact_page_settings"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_contact_coordinators_name" CHECK (btrim("name") <> ''),
        CONSTRAINT "CHK_contact_coordinators_email" CHECK ("email" IS NULL OR "email" = lower("email")),
        CONSTRAINT "CHK_contact_coordinators_order" CHECK ("displayOrder" >= 0)
      )`);
    await q.query(`CREATE INDEX "IDX_contact_coordinators_settingsId" ON "contact_coordinators" ("settingsId")`);

    /* Join rows are replaced wholesale on save, so they carry no soft-delete columns of their own. */
    await q.query(`
      CREATE TABLE "contact_coordinator_districts" (
        "coordinatorId" uuid NOT NULL,
        "districtId"    uuid NOT NULL,
        CONSTRAINT "PK_contact_coordinator_districts" PRIMARY KEY ("coordinatorId", "districtId"),
        CONSTRAINT "FK_contact_coordinator_districts_coordinator" FOREIGN KEY ("coordinatorId") REFERENCES "contact_coordinators"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_contact_coordinator_districts_district" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE RESTRICT
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_contact_coordinator_districts_district" ON "contact_coordinator_districts" ("districtId")`);

    await q.query(`
      CREATE TABLE "contact_district_offices" (${base},
        "settingsId"     uuid         NOT NULL,
        "districtId"     uuid         NOT NULL,
        "collectorName"  varchar(150) NULL,
        "addressMr"      varchar(500) NULL,
        "addressEn"      varchar(500) NULL,
        "phone"          varchar(32)  NULL,
        "email"          varchar(255) NULL,
        "officeHoursMr"  varchar(120) NULL,
        "officeHoursEn"  varchar(120) NULL,
        CONSTRAINT "PK_contact_district_offices" PRIMARY KEY ("id"),
        CONSTRAINT "FK_contact_district_offices_settings" FOREIGN KEY ("settingsId") REFERENCES "contact_page_settings"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_contact_district_offices_district" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_contact_district_offices_email" CHECK ("email" IS NULL OR "email" = lower("email")),
        CONSTRAINT "CHK_contact_district_offices_address_pair" CHECK (("addressMr" IS NULL) = ("addressEn" IS NULL)),
        CONSTRAINT "CHK_contact_district_offices_hours_pair" CHECK (("officeHoursMr" IS NULL) = ("officeHoursEn" IS NULL))
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_contact_district_offices_district_active" ON "contact_district_offices" ("districtId") WHERE "isDelete" = false`,
    );

    for (const t of ['contact_coordinators', 'contact_district_offices']) {
      await q.query(`CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "contact_district_offices"`);
    await q.query(`DROP TABLE IF EXISTS "contact_coordinator_districts"`);
    await q.query(`DROP TABLE IF EXISTS "contact_coordinators"`);
  }
}
