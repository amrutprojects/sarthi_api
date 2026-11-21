import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * G-2: Panel settings changed at run time by an administrator (src/modules/lms-reads/live-data-setting.*,
 * docs/mt-g2-live-data-setting.md). One row per setting key; the first key is `lms.live_data` ("Show live LMS data").
 *
 * No row is inserted: a missing row means the default (off), so the Panel keeps its current behaviour until an
 * administrator switches the setting on. Every change is also written to audit_logs in the same transaction.
 */
export class PanelSettings1798700000000 implements MigrationInterface {
  name = 'PanelSettings1798700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "panel_settings" (
        "key"             varchar(80) NOT NULL,
        "value"           jsonb       NOT NULL,
        "updatedByUserId" uuid        NULL,
        "createdAt"       timestamptz NOT NULL DEFAULT now(),
        "updatedAt"       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_panel_settings" PRIMARY KEY ("key")
      )`);
    await q.query(
      `CREATE TRIGGER "TRG_panel_settings_updated_at" BEFORE UPDATE ON "panel_settings" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "panel_settings"`);
  }
}
