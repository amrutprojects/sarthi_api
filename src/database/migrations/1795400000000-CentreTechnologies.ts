import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * A centre offers Technology / 3rd module selections (the technology_tracks master, T01–T12) instead of LMS courses:
 * the EDP portal's Technology dropdown lists the selected centre's technologies, and the separate Course Type field
 * is dropped.
 *
 * - edp_centre_technologies maps a centre to a technology track; one non-deleted row per pair (removal soft-deletes).
 * - edp_centre_courses (centre → LMS course) and students.courseId are dropped: no longer used. Their rows are not
 *   carried over (an LMS course has no technology track to map to).
 */
export class CentreTechnologies1795400000000 implements MigrationInterface {
  name = 'CentreTechnologies1795400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "edp_centre_technologies" (
        "id"                uuid        NOT NULL DEFAULT gen_random_uuid(),
        "createdAt"         timestamptz NOT NULL DEFAULT now(),
        "updatedAt"         timestamptz NOT NULL DEFAULT now(),
        "isDelete"          boolean     NOT NULL DEFAULT false,
        "isActive"          boolean     NOT NULL DEFAULT true,
        "centreId"          uuid        NOT NULL,
        "technologyTrackId" uuid        NOT NULL,
        CONSTRAINT "PK_edp_centre_technologies" PRIMARY KEY ("id"),
        CONSTRAINT "FK_edp_centre_technologies_centre" FOREIGN KEY ("centreId") REFERENCES "edp_centres"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_edp_centre_technologies_track" FOREIGN KEY ("technologyTrackId") REFERENCES "technology_tracks"("id") ON DELETE RESTRICT
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_edp_centre_technologies_pair_active" ON "edp_centre_technologies" ("centreId", "technologyTrackId") WHERE "isDelete" = false`,
    );
    await q.query(`CREATE INDEX "IDX_edp_centre_technologies_track" ON "edp_centre_technologies" ("technologyTrackId")`);
    await q.query(
      `CREATE TRIGGER "TRG_edp_centre_technologies_updated_at" BEFORE UPDATE ON "edp_centre_technologies" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`,
    );

    await q.query(`DROP TABLE IF EXISTS "edp_centre_courses"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_students_courseId"`);
    await q.query(`ALTER TABLE "students" DROP CONSTRAINT IF EXISTS "FK_students_courseId"`);
    await q.query(`ALTER TABLE "students" DROP COLUMN IF EXISTS "courseId"`);
  }

  public async down(q: QueryRunner): Promise<void> {
    /* Puts the course columns back (empty); the technology allocations are dropped. */
    await q.query(`ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "courseId" uuid NULL`);
    await q.query(
      `ALTER TABLE "students" ADD CONSTRAINT "FK_students_courseId" FOREIGN KEY ("courseId") REFERENCES "lms_courses"("id") ON DELETE RESTRICT`,
    );
    await q.query(`CREATE INDEX "IDX_students_courseId" ON "students" ("courseId")`);
    await q.query(`
      CREATE TABLE "edp_centre_courses" (
        "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "isDelete"  boolean     NOT NULL DEFAULT false,
        "isActive"  boolean     NOT NULL DEFAULT true,
        "centreId"  uuid        NOT NULL,
        "courseId"  uuid        NOT NULL,
        CONSTRAINT "PK_edp_centre_courses" PRIMARY KEY ("id"),
        CONSTRAINT "FK_edp_centre_courses_centre" FOREIGN KEY ("centreId") REFERENCES "edp_centres"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_edp_centre_courses_course" FOREIGN KEY ("courseId") REFERENCES "lms_courses"("id") ON DELETE RESTRICT
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_edp_centre_courses_pair_active" ON "edp_centre_courses" ("centreId", "courseId") WHERE "isDelete" = false`,
    );
    await q.query(`CREATE INDEX "IDX_edp_centre_courses_courseId" ON "edp_centre_courses" ("courseId")`);
    await q.query(`DROP TABLE IF EXISTS "edp_centre_technologies"`);
  }
}
