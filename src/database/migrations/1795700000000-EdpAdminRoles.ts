import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * EDP tracking panel roles: ADMIN (everything, including adding users) and VIEWER (views and downloads only: applicants,
 * their details and documents, follow-up history and the Center Master; no changes). Existing admins become ADMIN.
 */
export class EdpAdminRoles1795700000000 implements MigrationInterface {
  name = 'EdpAdminRoles1795700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "edp_admins" ADD COLUMN "role" varchar(10) NOT NULL DEFAULT 'ADMIN'`);
    await q.query(`ALTER TABLE "edp_admins" ADD CONSTRAINT "CHK_edp_admins_role" CHECK ("role" IN ('ADMIN', 'VIEWER'))`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "edp_admins" DROP CONSTRAINT IF EXISTS "CHK_edp_admins_role"`);
    await q.query(`ALTER TABLE "edp_admins" DROP COLUMN IF EXISTS "role"`);
  }
}
