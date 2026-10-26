import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * EDP portal "Forgot password": the pending reset link of an account (an HMAC of its token, never the token itself; null
 * when none is pending), when it expires and when it was sent, the links sent in the current hour (a per-account limit),
 * and when the password was last changed (portal sessions signed in before that are no longer accepted). Additive only.
 */
export class EdpPasswordReset1795000000000 implements MigrationInterface {
  name = 'EdpPasswordReset1795000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "edp_accounts"
        ADD COLUMN "resetTokenHash"    char(64)    NULL,
        ADD COLUMN "resetExpiresAt"    timestamptz NULL,
        ADD COLUMN "resetSentAt"       timestamptz NULL,
        ADD COLUMN "resetSendCount"    integer     NOT NULL DEFAULT 0,
        ADD COLUMN "resetWindowStart"  timestamptz NULL,
        ADD COLUMN "passwordChangedAt" timestamptz NULL`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_edp_accounts_reset_token" ON "edp_accounts" ("resetTokenHash") WHERE "resetTokenHash" IS NOT NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "UQ_edp_accounts_reset_token"`);
    await q.query(`
      ALTER TABLE "edp_accounts"
        DROP COLUMN IF EXISTS "passwordChangedAt",
        DROP COLUMN IF EXISTS "resetWindowStart",
        DROP COLUMN IF EXISTS "resetSendCount",
        DROP COLUMN IF EXISTS "resetSentAt",
        DROP COLUMN IF EXISTS "resetExpiresAt",
        DROP COLUMN IF EXISTS "resetTokenHash"`);
  }
}
