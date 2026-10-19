import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * CMS geography masters: states, districts, talukas (State → District → Taluka).
 *
 * Follows the conventions of the initial schema:
 * - The common columns (id UUID, createdAt / updatedAt TIMESTAMPTZ, isDelete, isActive).
 * - Foreign keys are NOT NULL and RESTRICT: the application soft-deletes, so a parent row is never
 *   physically removed and a child can never be orphaned.
 * - Uniqueness uses PARTIAL unique indexes over non-deleted rows, so a soft-deleted record keeps its
 *   history without blocking a new record with the same name or code.
 * - Names are compared case-insensitively: the unique indexes are on lower("name").
 * - The set_updated_at trigger keeps updatedAt correct for raw / bulk SQL too.
 *
 * Scope of uniqueness (the business rules this schema enforces):
 * - state  name and code    unique across all states
 * - district name and code  unique WITHIN its state   (two states may both have a "Bid")
 * - taluka  name            unique within its district
 * - taluka  code            unique within its district when given (the column is nullable)
 *
 * Creates tables only; no existing table or row is touched.
 */
export class CmsGeography1792200000000 implements MigrationInterface {
  name = 'CmsGeography1792200000000';

  public async up(q: QueryRunner): Promise<void> {
    const base = `
      "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "isDelete"  boolean     NOT NULL DEFAULT false,
      "isActive"  boolean     NOT NULL DEFAULT true`;

    await q.query(`
      CREATE TABLE "states" (${base},
        "name" varchar(100) NOT NULL,
        "code" varchar(10)  NOT NULL,
        CONSTRAINT "PK_states" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_states_name_trimmed" CHECK ("name" = btrim("name") AND length("name") >= 2),
        CONSTRAINT "CHK_states_code_upper"   CHECK ("code" = upper("code") AND "code" ~ '^[A-Z][A-Z0-9]{1,9}$')
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_states_code_active" ON "states" ("code") WHERE "isDelete" = false`);
    await q.query(`CREATE UNIQUE INDEX "UQ_states_name_active" ON "states" (lower("name")) WHERE "isDelete" = false`);

    await q.query(`
      CREATE TABLE "districts" (${base},
        "stateId" uuid         NOT NULL,
        "name"    varchar(100) NOT NULL,
        "code"    varchar(20)  NOT NULL,
        CONSTRAINT "PK_districts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_districts_state" FOREIGN KEY ("stateId") REFERENCES "states"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_districts_name_trimmed" CHECK ("name" = btrim("name") AND length("name") >= 2),
        CONSTRAINT "CHK_districts_code_upper"   CHECK ("code" = upper("code") AND "code" ~ '^[A-Z][A-Z0-9-]{1,19}$')
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_districts_state_code_active" ON "districts" ("stateId", "code") WHERE "isDelete" = false`);
    await q.query(`CREATE UNIQUE INDEX "UQ_districts_state_name_active" ON "districts" ("stateId", lower("name")) WHERE "isDelete" = false`);
    await q.query(`CREATE INDEX "IDX_districts_stateId" ON "districts" ("stateId")`);

    await q.query(`
      CREATE TABLE "talukas" (${base},
        "districtId" uuid         NOT NULL,
        "name"       varchar(100) NOT NULL,
        "code"       varchar(20)  NULL,
        CONSTRAINT "PK_talukas" PRIMARY KEY ("id"),
        CONSTRAINT "FK_talukas_district" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_talukas_name_trimmed" CHECK ("name" = btrim("name") AND length("name") >= 2),
        CONSTRAINT "CHK_talukas_code_upper"   CHECK ("code" IS NULL OR ("code" = upper("code") AND "code" ~ '^[A-Z][A-Z0-9-]{1,19}$'))
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_talukas_district_name_active" ON "talukas" ("districtId", lower("name")) WHERE "isDelete" = false`);
    await q.query(`CREATE UNIQUE INDEX "UQ_talukas_district_code_active" ON "talukas" ("districtId", "code") WHERE "isDelete" = false AND "code" IS NOT NULL`);
    await q.query(`CREATE INDEX "IDX_talukas_districtId" ON "talukas" ("districtId")`);

    for (const t of ['states', 'districts', 'talukas']) {
      await q.query(`CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
    }
  }

  /* Children first: the foreign keys are RESTRICT. */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "talukas"`);
    await q.query(`DROP TABLE IF EXISTS "districts"`);
    await q.query(`DROP TABLE IF EXISTS "states"`);
  }
}
