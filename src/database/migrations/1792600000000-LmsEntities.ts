import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * LMS Admin — Entity Master (AMRUT_KALASH_03 L-03 / FR-303, form F-LMS-03 Table 28, table DB-302):
 * lms_entities plus the per-entity selections of Admin Panel centres and tracks (F-LMS-03-04 / -05).
 *
 * Same conventions as CmsMasters:
 * - The common columns (id UUID, createdAt / updatedAt TIMESTAMPTZ, isDelete, isActive). isActive is the
 *   entity status (F-LMS-03-08 ACTIVE / INACTIVE); archive is the soft delete.
 * - Uniqueness uses PARTIAL unique indexes over non-deleted rows; the name compares case-insensitively.
 * - CHECK constraints repeat the validators' shape rules.
 * - Foreign keys are RESTRICT; the service refuses to delete a still-referenced entity.
 * - training_centres and technology_tracks belong to the Admin Panel: only referenced here, never written.
 *
 * Nothing is seeded: the recommended single entity "AMRUT KALASH" (OQ-009) is still an open question and
 * no entity code is defined for it, so the entity is created through the Entity Master screen.
 */
export class LmsEntities1792600000000 implements MigrationInterface {
  name = 'LmsEntities1792600000000';

  public async up(q: QueryRunner): Promise<void> {
    const base = `
      "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "isDelete"  boolean     NOT NULL DEFAULT false,
      "isActive"  boolean     NOT NULL DEFAULT true`;

    await q.query(`
      CREATE TABLE "lms_entities" (${base},
        "name"            varchar(120) NOT NULL,
        "code"            varchar(20)  NOT NULL,
        "description"     varchar(500) NULL,
        "defaultLanguage" varchar(10)  NOT NULL,
        "timeZone"        varchar(64)  NOT NULL DEFAULT 'Asia/Kolkata',
        CONSTRAINT "PK_lms_entities" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_lms_entities_name_trimmed" CHECK ("name" = btrim("name") AND length("name") >= 3),
        CONSTRAINT "CHK_lms_entities_code_upper" CHECK ("code" = upper("code") AND "code" ~ '^[A-Z0-9-]{2,20}$'),
        CONSTRAINT "CHK_lms_entities_description_trimmed" CHECK ("description" IS NULL OR ("description" = btrim("description") AND length("description") >= 1)),
        CONSTRAINT "CHK_lms_entities_default_language" CHECK ("defaultLanguage" ~ '^[a-z]{2,3}$'),
        CONSTRAINT "CHK_lms_entities_time_zone" CHECK ("timeZone" ~ '^([A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)+|UTC)$')
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_lms_entities_code_active" ON "lms_entities" ("code") WHERE "isDelete" = false`);
    await q.query(`CREATE UNIQUE INDEX "UQ_lms_entities_name_active" ON "lms_entities" (lower("name")) WHERE "isDelete" = false`);
    /* DB-302 Table 94: status is indexed. */
    await q.query(`CREATE INDEX "IDX_lms_entities_isActive" ON "lms_entities" ("isActive")`);

    await q.query(`
      CREATE TABLE "lms_entity_centres" (${base},
        "entityId" uuid NOT NULL,
        "centreId" uuid NOT NULL,
        CONSTRAINT "PK_lms_entity_centres" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lms_entity_centres_entity" FOREIGN KEY ("entityId") REFERENCES "lms_entities"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_lms_entity_centres_centre" FOREIGN KEY ("centreId") REFERENCES "training_centres"("id") ON DELETE RESTRICT
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_lms_entity_centres_pair_active" ON "lms_entity_centres" ("entityId", "centreId") WHERE "isDelete" = false`);
    await q.query(`CREATE INDEX "IDX_lms_entity_centres_entityId" ON "lms_entity_centres" ("entityId")`);
    await q.query(`CREATE INDEX "IDX_lms_entity_centres_centreId" ON "lms_entity_centres" ("centreId")`);

    await q.query(`
      CREATE TABLE "lms_entity_tracks" (${base},
        "entityId" uuid NOT NULL,
        "trackId"  uuid NOT NULL,
        CONSTRAINT "PK_lms_entity_tracks" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lms_entity_tracks_entity" FOREIGN KEY ("entityId") REFERENCES "lms_entities"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_lms_entity_tracks_track" FOREIGN KEY ("trackId") REFERENCES "technology_tracks"("id") ON DELETE RESTRICT
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_lms_entity_tracks_pair_active" ON "lms_entity_tracks" ("entityId", "trackId") WHERE "isDelete" = false`);
    await q.query(`CREATE INDEX "IDX_lms_entity_tracks_entityId" ON "lms_entity_tracks" ("entityId")`);
    await q.query(`CREATE INDEX "IDX_lms_entity_tracks_trackId" ON "lms_entity_tracks" ("trackId")`);

    for (const t of ['lms_entities', 'lms_entity_centres', 'lms_entity_tracks']) {
      await q.query(`CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "lms_entity_tracks"`);
    await q.query(`DROP TABLE IF EXISTS "lms_entity_centres"`);
    await q.query(`DROP TABLE IF EXISTS "lms_entities"`);
  }
}
