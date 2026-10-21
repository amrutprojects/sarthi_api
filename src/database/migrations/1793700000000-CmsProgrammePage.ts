import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Programme page content (public site /programme), managed in the CMS. A singleton, like the Contact and Modules pages:
 * a unique index on a constant expression admits one non-deleted row. The lists are JSONB arrays (checked to be
 * arrays here; their item shape is validated by the API). The content itself is created by the seed.
 */
export class CmsProgrammePage1793700000000 implements MigrationInterface {
  name = 'CmsProgrammePage1793700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "programme_page_settings" (
        "id"               uuid         NOT NULL DEFAULT gen_random_uuid(),
        "createdAt"        timestamptz  NOT NULL DEFAULT now(),
        "updatedAt"        timestamptz  NOT NULL DEFAULT now(),
        "isDelete"         boolean      NOT NULL DEFAULT false,
        "isActive"         boolean      NOT NULL DEFAULT true,
        "introMr"          varchar(500) NOT NULL,
        "introEn"          varchar(500) NOT NULL,
        "objectives"       jsonb        NOT NULL DEFAULT '[]'::jsonb,
        "methodology"      jsonb        NOT NULL DEFAULT '[]'::jsonb,
        "assessment"       jsonb        NOT NULL DEFAULT '[]'::jsonb,
        "assessmentNoteMr" varchar(500) NOT NULL,
        "assessmentNoteEn" varchar(500) NOT NULL,
        "certification"    jsonb        NOT NULL DEFAULT '[]'::jsonb,
        "trainingModes"    jsonb        NOT NULL,
        "isPublished"      boolean      NOT NULL DEFAULT true,
        CONSTRAINT "PK_programme_page_settings" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_programme_page_settings_lists" CHECK (
          jsonb_typeof("objectives") = 'array' AND jsonb_typeof("methodology") = 'array'
          AND jsonb_typeof("assessment") = 'array' AND jsonb_typeof("certification") = 'array'
          AND jsonb_typeof("trainingModes") = 'object' AND jsonb_typeof("trainingModes"->'modes') = 'array'
        ),
        CONSTRAINT "CHK_programme_page_settings_text" CHECK (
          btrim("introMr") <> '' AND btrim("introEn") <> '' AND btrim("assessmentNoteMr") <> '' AND btrim("assessmentNoteEn") <> ''
        )
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_programme_page_settings_singleton" ON "programme_page_settings" ((true)) WHERE "isDelete" = false`,
    );
    await q.query(
      `CREATE TRIGGER "TRG_programme_page_settings_updated_at" BEFORE UPDATE ON "programme_page_settings" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "programme_page_settings"`);
  }
}
