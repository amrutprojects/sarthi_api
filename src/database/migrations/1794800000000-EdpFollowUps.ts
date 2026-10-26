import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * EDP tracking panel follow-ups: each time the EDP team follows up a student (a call, a second call, the form filled),
 * one row with the status and an optional note, and who recorded it. The latest row is the student's current follow-up
 * status; the earlier ones are its history. Additive only.
 */
export class EdpFollowUps1794800000000 implements MigrationInterface {
  name = 'EdpFollowUps1794800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "edp_follow_ups" (
        "id"        uuid         NOT NULL DEFAULT gen_random_uuid(),
        "accountId" uuid         NOT NULL,
        "status"    varchar(20)  NOT NULL,
        "note"      varchar(1000) NULL,
        "adminId"   uuid         NULL,
        "createdAt" timestamptz  NOT NULL DEFAULT now(),
        "updatedAt" timestamptz  NOT NULL DEFAULT now(),
        "isDelete"  boolean      NOT NULL DEFAULT false,
        "isActive"  boolean      NOT NULL DEFAULT true,
        CONSTRAINT "PK_edp_follow_ups" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_edp_follow_ups_status" CHECK ("status" IN ('PENDING', 'CALLED', 'SECOND_CALL', 'FORM_FILLED')),
        CONSTRAINT "FK_edp_follow_ups_account" FOREIGN KEY ("accountId") REFERENCES "edp_accounts"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_edp_follow_ups_admin" FOREIGN KEY ("adminId") REFERENCES "edp_admins"("id") ON DELETE SET NULL
      )`);
    await q.query(`CREATE INDEX "IDX_edp_follow_ups_account_created" ON "edp_follow_ups" ("accountId", "createdAt" DESC)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "edp_follow_ups"`);
  }
}
