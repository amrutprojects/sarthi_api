import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * LMS Admin — Course Master (AMRUT_KALASH_03 L-06 / FR-306, form F-LMS-06 Table 31, table DB-310 "course").
 *
 * Same conventions as LmsEntities:
 * - The common columns (id UUID, createdAt / updatedAt TIMESTAMPTZ, isDelete, isActive).
 * - The course code is unique over non-deleted rows (DB-310 key course_code).
 * - CHECK constraints repeat the validators' shape rules and the lifecycle (DRAFT / PUBLISHED / RETIRED).
 * - The entity foreign key is RESTRICT; the Entity Master refuses to delete an entity a course uses.
 * - publishedReleaseId / publishedReleaseNo point at the content release (DB-312), which is not built yet:
 *   no foreign key until that table exists. A course leaves DRAFT only through a published release, so
 *   DRAFT ⇔ no release.
 *
 * Nothing is seeded: the spec recommends one course for AMRUT KALASH but gives no code for it.
 */
export class LmsCourses1792730000000 implements MigrationInterface {
  name = 'LmsCourses1792730000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "lms_courses" (
        "id"                 uuid          NOT NULL DEFAULT gen_random_uuid(),
        "createdAt"          timestamptz   NOT NULL DEFAULT now(),
        "updatedAt"          timestamptz   NOT NULL DEFAULT now(),
        "isDelete"           boolean       NOT NULL DEFAULT false,
        "isActive"           boolean       NOT NULL DEFAULT true,
        "entityId"           uuid          NOT NULL,
        "code"               varchar(20)   NOT NULL,
        "title"              varchar(120)  NOT NULL,
        "description"        varchar(2000) NULL,
        "languages"          varchar(10)[] NOT NULL,
        "status"             varchar(10)   NOT NULL DEFAULT 'DRAFT',
        "publishedReleaseId" uuid          NULL,
        "publishedReleaseNo" integer       NULL,
        CONSTRAINT "PK_lms_courses" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lms_courses_entity" FOREIGN KEY ("entityId") REFERENCES "lms_entities"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_lms_courses_code_upper" CHECK ("code" = upper("code") AND "code" ~ '^[A-Z0-9-]{2,20}$'),
        CONSTRAINT "CHK_lms_courses_title_trimmed" CHECK ("title" = btrim("title") AND length("title") >= 3),
        CONSTRAINT "CHK_lms_courses_description_trimmed" CHECK ("description" IS NULL OR ("description" = btrim("description") AND length("description") >= 1)),
        CONSTRAINT "CHK_lms_courses_languages" CHECK (cardinality("languages") >= 1 AND array_to_string("languages", ',') ~ '^[a-z]{2,3}(,[a-z]{2,3})*$'),
        CONSTRAINT "CHK_lms_courses_status" CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
        CONSTRAINT "CHK_lms_courses_release_pair" CHECK (("publishedReleaseId" IS NULL) = ("publishedReleaseNo" IS NULL)),
        CONSTRAINT "CHK_lms_courses_release_no" CHECK ("publishedReleaseNo" IS NULL OR "publishedReleaseNo" > 0),
        CONSTRAINT "CHK_lms_courses_draft_release" CHECK (("status" = 'DRAFT') = ("publishedReleaseId" IS NULL))
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_lms_courses_code_active" ON "lms_courses" ("code") WHERE "isDelete" = false`);
    await q.query(`CREATE INDEX "IDX_lms_courses_entityId" ON "lms_courses" ("entityId")`);
    await q.query(`CREATE INDEX "IDX_lms_courses_isActive" ON "lms_courses" ("isActive")`);
    /* DB-310: status is indexed (L-06 filter status). */
    await q.query(`CREATE INDEX "IDX_lms_courses_status" ON "lms_courses" ("status")`);
    await q.query(`CREATE TRIGGER "TRG_lms_courses_updated_at" BEFORE UPDATE ON "lms_courses" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "lms_courses"`);
  }
}
