import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * LMS Admin — Module Master (AMRUT_KALASH_03 L-06 / FR-306, form F-LMS-07 Table 32, table DB-310
 * "course_module"; programme learning model section 2.1).
 *
 * Same conventions as LmsEntities:
 * - The common columns (id UUID, createdAt / updatedAt TIMESTAMPTZ, isDelete, isActive).
 * - BRL-310: module number 1–4, one non-deleted row per (course, number) — partial unique index. The Module 3
 *   variants per track (the spec's "(course, module_no, track)") are the Track Variant master's tables.
 * - BRL-336: core hours and the OFT range are separate columns; nothing subtracts one from the other.
 * - CHECK constraints repeat F-LMS-07-04 / -05 / -07 / -08: hours > 0; the syllabus reference is required
 *   with the core hours; each delivery pair is complete and adds up to the core hours; 0 < OFT minimum ≤
 *   maximum. Every hour value may be empty until release.
 * - The course foreign key is RESTRICT; the Course Master refuses to delete a course with modules.
 *
 * Nothing is seeded: modules belong to a course and no course is seeded. The prescribed values (section
 * 2.1, BRL-335) are offered by POST /lms/course-modules/prescribed (course-module.constants.ts).
 */
export class LmsCourseModules1792740000000 implements MigrationInterface {
  name = 'LmsCourseModules1792740000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "lms_course_modules" (
        "id"             uuid          NOT NULL DEFAULT gen_random_uuid(),
        "createdAt"      timestamptz   NOT NULL DEFAULT now(),
        "updatedAt"      timestamptz   NOT NULL DEFAULT now(),
        "isDelete"       boolean       NOT NULL DEFAULT false,
        "isActive"       boolean       NOT NULL DEFAULT true,
        "courseId"       uuid          NOT NULL,
        "moduleNumber"   smallint      NOT NULL,
        "title"          varchar(160)  NOT NULL,
        "description"    varchar(3000) NULL,
        "coreHours"      numeric(6,2)  NULL,
        "syllabusRef"    varchar(120)  NULL,
        "sessions"       smallint      NULL,
        "sessionHours"   smallint      NULL,
        "lectureHours"   numeric(6,2)  NULL,
        "practicalHours" numeric(6,2)  NULL,
        "oftHoursMin"    numeric(6,2)  NULL,
        "oftHoursMax"    numeric(6,2)  NULL,
        "status"         varchar(10)   NOT NULL DEFAULT 'DRAFT',
        CONSTRAINT "PK_lms_course_modules" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lms_course_modules_course" FOREIGN KEY ("courseId") REFERENCES "lms_courses"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_lms_course_modules_number" CHECK ("moduleNumber" BETWEEN 1 AND 4),
        CONSTRAINT "CHK_lms_course_modules_title_trimmed" CHECK ("title" = btrim("title") AND length("title") >= 3),
        CONSTRAINT "CHK_lms_course_modules_description_trimmed" CHECK ("description" IS NULL OR ("description" = btrim("description") AND length("description") >= 1)),
        CONSTRAINT "CHK_lms_course_modules_syllabus_ref_trimmed" CHECK ("syllabusRef" IS NULL OR ("syllabusRef" = btrim("syllabusRef") AND length("syllabusRef") >= 1)),
        CONSTRAINT "CHK_lms_course_modules_syllabus_ref_required" CHECK ("coreHours" IS NULL OR "syllabusRef" IS NOT NULL),
        CONSTRAINT "CHK_lms_course_modules_core_hours" CHECK ("coreHours" IS NULL OR "coreHours" > 0),
        CONSTRAINT "CHK_lms_course_modules_sessions" CHECK (
          ("sessions" IS NULL AND "sessionHours" IS NULL)
          OR ("sessions" > 0 AND "sessionHours" > 0 AND "coreHours" IS NOT NULL AND "sessions" * "sessionHours" = "coreHours")
        ),
        CONSTRAINT "CHK_lms_course_modules_lecture_practical" CHECK (
          ("lectureHours" IS NULL AND "practicalHours" IS NULL)
          OR ("lectureHours" > 0 AND "practicalHours" > 0 AND "coreHours" IS NOT NULL AND "lectureHours" + "practicalHours" = "coreHours")
        ),
        CONSTRAINT "CHK_lms_course_modules_oft_range" CHECK (
          ("oftHoursMin" IS NULL AND "oftHoursMax" IS NULL)
          OR ("oftHoursMin" > 0 AND "oftHoursMin" <= "oftHoursMax")
        ),
        CONSTRAINT "CHK_lms_course_modules_status" CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'RETIRED'))
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_lms_course_modules_number_active" ON "lms_course_modules" ("courseId", "moduleNumber") WHERE "isDelete" = false`);
    await q.query(`CREATE INDEX "IDX_lms_course_modules_courseId" ON "lms_course_modules" ("courseId")`);
    await q.query(`CREATE INDEX "IDX_lms_course_modules_isActive" ON "lms_course_modules" ("isActive")`);
    await q.query(`CREATE TRIGGER "TRG_lms_course_modules_updated_at" BEFORE UPDATE ON "lms_course_modules" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "lms_course_modules"`);
  }
}
