import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Center Master (Masters sidebar group and the EDP tracking panel): the centres a student of the EDP portal chooses
 * in step 2, and the LMS courses ("course types") each centre offers.
 *
 * - centres repeats the College Master's columns (district required, taluka optional, address, PIN, contact,
 *   email) plus a contact person; same CHECKs and partial unique indexes (code overall, name per district).
 * - centre_courses maps a centre to an LMS course; one non-deleted row per pair. Removing a course from a centre
 *   soft-deletes its row, so history stays readable.
 * Creates tables only; no existing table or row is touched.
 */
export class CentreMaster1795200000000 implements MigrationInterface {
  name = 'CentreMaster1795200000000';

  public async up(q: QueryRunner): Promise<void> {
    const base = `
      "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "isDelete"  boolean     NOT NULL DEFAULT false,
      "isActive"  boolean     NOT NULL DEFAULT true`;

    await q.query(`
      CREATE TABLE "edp_centres" (${base},
        "name"          varchar(150) NOT NULL,
        "code"          varchar(20)  NOT NULL,
        "districtId"    uuid         NOT NULL,
        "talukaId"      uuid         NULL,
        "address"       varchar(300) NULL,
        "pinCode"       char(6)      NULL,
        "contactPerson" varchar(120) NULL,
        "contactNumber" varchar(15)  NULL,
        "email"         varchar(254) NULL,
        CONSTRAINT "PK_edp_centres" PRIMARY KEY ("id"),
        CONSTRAINT "FK_edp_centres_district" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_edp_centres_taluka" FOREIGN KEY ("talukaId") REFERENCES "talukas"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_edp_centres_name_trimmed" CHECK ("name" = btrim("name") AND length("name") >= 2),
        CONSTRAINT "CHK_edp_centres_code_upper" CHECK ("code" = upper("code") AND "code" ~ '^[A-Z][A-Z0-9-]{1,19}$'),
        CONSTRAINT "CHK_edp_centres_pin" CHECK ("pinCode" IS NULL OR "pinCode" ~ '^[0-9]{6}$')
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_edp_centres_code_active" ON "edp_centres" ("code") WHERE "isDelete" = false`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_edp_centres_district_name_active" ON "edp_centres" ("districtId", lower("name")) WHERE "isDelete" = false`,
    );
    await q.query(`CREATE INDEX "IDX_edp_centres_districtId" ON "edp_centres" ("districtId")`);
    await q.query(`CREATE INDEX "IDX_edp_centres_talukaId" ON "edp_centres" ("talukaId")`);

    await q.query(`
      CREATE TABLE "edp_centre_courses" (${base},
        "centreId" uuid NOT NULL,
        "courseId" uuid NOT NULL,
        CONSTRAINT "PK_edp_centre_courses" PRIMARY KEY ("id"),
        CONSTRAINT "FK_edp_centre_courses_centre" FOREIGN KEY ("centreId") REFERENCES "edp_centres"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_edp_centre_courses_course" FOREIGN KEY ("courseId") REFERENCES "lms_courses"("id") ON DELETE RESTRICT
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_edp_centre_courses_pair_active" ON "edp_centre_courses" ("centreId", "courseId") WHERE "isDelete" = false`,
    );
    await q.query(`CREATE INDEX "IDX_edp_centre_courses_courseId" ON "edp_centre_courses" ("courseId")`);

    for (const t of ['edp_centres', 'edp_centre_courses'])
      await q.query(`CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "edp_centre_courses"`);
    await q.query(`DROP TABLE IF EXISTS "edp_centres"`);
  }
}
