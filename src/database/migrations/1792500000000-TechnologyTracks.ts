import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Technology tracks — the Admin Panel's reference list of the twelve Module 3 tracks (AMRUT_KALASH_02
 * F-ADM-15 Table 34 / Table 8; AMRUT_KALASH_03 reference copy track_ref, DB-303).
 *
 * Owned by the Admin Panel; the LMS Admin reads it as read-only reference data (same database, no copy).
 * Seeded with the approved codes, names and source aliases already used by the student import
 * (src/modules/students/student.constants.ts TRACKS, which follows Table 8 and Table 79). Marathi names and
 * sort order are not defined by the specification, so no Marathi column is added and the order is the code order.
 */
export class TechnologyTracks1792500000000 implements MigrationInterface {
  name = 'TechnologyTracks1792500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "technology_tracks" (
        "id"        uuid         NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz  NOT NULL DEFAULT now(),
        "updatedAt" timestamptz  NOT NULL DEFAULT now(),
        "isDelete"  boolean      NOT NULL DEFAULT false,
        "isActive"  boolean      NOT NULL DEFAULT true,
        "code"      varchar(4)   NOT NULL,
        "name"      varchar(120) NOT NULL,
        "aliases"   jsonb        NOT NULL DEFAULT '[]'::jsonb,
        "sortOrder" integer      NOT NULL,
        CONSTRAINT "PK_technology_tracks" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_technology_tracks_code" CHECK ("code" ~ '^T[0-9]{2}$'),
        CONSTRAINT "CHK_technology_tracks_name_trimmed" CHECK ("name" = btrim("name") AND length("name") >= 2),
        CONSTRAINT "CHK_technology_tracks_aliases" CHECK (jsonb_typeof("aliases") = 'array')
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_technology_tracks_code_active" ON "technology_tracks" ("code") WHERE "isDelete" = false`);
    await q.query(`CREATE UNIQUE INDEX "UQ_technology_tracks_name_active" ON "technology_tracks" (lower("name")) WHERE "isDelete" = false`);
    await q.query(`
      INSERT INTO "technology_tracks" ("code", "name", "aliases", "sortOrder") VALUES
        ('T01', 'Data Analytics & Business Intelligence', '["Data Analytics & Business Intelligence"]', 1),
        ('T02', 'Graphic Design & Digital Branding', '["Graphic Design & Digital Branding"]', 2),
        ('T03', 'Web Design & Development', '["Web Design & Development"]', 3),
        ('T04', 'Application Development', '["Application Development"]', 4),
        ('T05', 'IT Infrastructure & Smart Technologies', '["IT Infrastructure & Smart Technologies"]', 5),
        ('T06', 'Retail & E-Commerce Management', '["Retail & E-Commerce Management"]', 6),
        ('T07', 'Cyber Security', '["Cyber Security"]', 7),
        ('T08', 'AI/ML Engineer', '["AI/ML Engineer", "AI-ML Engineer"]', 8),
        ('T09', 'Data Scientist', '["Data Scientist"]', 9),
        ('T10', 'Social Media Marketing / Digital Marketing', '["Social Media Marketing / Digital Marketing", "Social Media & Digital Marketing"]', 10),
        ('T11', 'Blockchain', '["Blockchain"]', 11),
        ('T12', 'Office Process Automation (OPA)', '["Office Process Automation (OPA)", "Office Process Automation"]', 12)`);
    await q.query(`CREATE TRIGGER "TRG_technology_tracks_updated_at" BEFORE UPDATE ON "technology_tracks" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "technology_tracks"`);
  }
}
