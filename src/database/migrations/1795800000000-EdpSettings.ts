import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Settings the EDP tracking panel edits, one row per key (value as JSON). First key: "support", the contact line shown
 * to students after submitting and in the portal's emails ({ message, email, mobile }). Without a row, the defaults
 * (EDP_SUPPORT_EMAIL / EDP_SUPPORT_MOBILE and the standard message) apply.
 */
export class EdpSettings1795800000000 implements MigrationInterface {
  name = 'EdpSettings1795800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "edp_settings" (
        "key"         varchar(50) NOT NULL,
        "value"       jsonb       NOT NULL,
        "updatedAt"   timestamptz NOT NULL DEFAULT now(),
        "updatedById" uuid        NULL,
        CONSTRAINT "PK_edp_settings" PRIMARY KEY ("key"),
        CONSTRAINT "FK_edp_settings_updated_by" FOREIGN KEY ("updatedById") REFERENCES "edp_admins"("id") ON DELETE SET NULL
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "edp_settings"`);
  }
}
