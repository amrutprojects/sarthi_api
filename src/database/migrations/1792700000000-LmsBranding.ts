import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * LMS Admin — Branding and Settings (AMRUT_KALASH_03 L-04 / FR-304, form F-LMS-04 Table 29, DB-302
 * "entity_setting"): the typed key-value settings of each LMS entity.
 *
 * Same conventions as LmsEntities:
 * - The common columns (id UUID, createdAt / updatedAt TIMESTAMPTZ, isDelete, isActive). L-04 settings have
 *   no status ("versioned by audit"), so isActive is not used.
 * - One non-deleted row per (entity, key): PARTIAL unique index over non-deleted rows.
 * - CHECK constraints repeat the shape rules: the key is a catalogue key name (the service accepts only
 *   the keys of branding.constants.ts); the value is JSON validated by the server against the key's type.
 * - The entity foreign key is RESTRICT.
 *
 * Nothing is seeded: the spec's defaults (entity name, default language, platform default) are applied
 * when a value is read, and no default colour or logo is defined by the spec.
 */
export class LmsBranding1792700000000 implements MigrationInterface {
  name = 'LmsBranding1792700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "lms_entity_settings" (
        "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "isDelete"  boolean     NOT NULL DEFAULT false,
        "isActive"  boolean     NOT NULL DEFAULT true,
        "entityId"  uuid        NOT NULL,
        "key"       varchar(64) NOT NULL,
        "value"     jsonb       NULL,
        CONSTRAINT "PK_lms_entity_settings" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lms_entity_settings_entity" FOREIGN KEY ("entityId") REFERENCES "lms_entities"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_lms_entity_settings_key" CHECK ("key" ~ '^[a-z][a-z0-9_.]{1,63}$')
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_lms_entity_settings_key_active" ON "lms_entity_settings" ("entityId", "key") WHERE "isDelete" = false`);
    await q.query(`CREATE INDEX "IDX_lms_entity_settings_entityId" ON "lms_entity_settings" ("entityId")`);
    await q.query(
      `CREATE TRIGGER "TRG_lms_entity_settings_updated_at" BEFORE UPDATE ON "lms_entity_settings" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "lms_entity_settings"`);
  }
}
