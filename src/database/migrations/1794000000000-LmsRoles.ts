import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * LMS roles in the Admin Panel: roles.platform (ADMIN = Admin Panel role, LMS = LMS role) and the LMS permission codes
 * ticked on an LMS role ("LMS menus"), handed to the LMS when a holder signs in there.
 */
export class LmsRoles1794000000000 implements MigrationInterface {
  name = 'LmsRoles1794000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "roles" ADD COLUMN "platform" varchar(10) NOT NULL DEFAULT 'ADMIN'`);
    await q.query(`ALTER TABLE "roles" ADD CONSTRAINT "CHK_roles_platform" CHECK ("platform" IN ('ADMIN', 'LMS'))`);
    await q.query(`
      CREATE TABLE "role_lms_permissions" (
        "id"           uuid         NOT NULL DEFAULT gen_random_uuid(),
        "createdAt"    timestamptz  NOT NULL DEFAULT now(),
        "updatedAt"    timestamptz  NOT NULL DEFAULT now(),
        "isDelete"     boolean      NOT NULL DEFAULT false,
        "isActive"     boolean      NOT NULL DEFAULT true,
        "roleId"       uuid         NOT NULL,
        "code"         varchar(100) NOT NULL,
        "assignedById" uuid         NULL,
        CONSTRAINT "PK_role_lms_permissions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_role_lms_permissions_role"       FOREIGN KEY ("roleId")       REFERENCES "roles"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_role_lms_permissions_assignedBy" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_role_lms_permissions_active" ON "role_lms_permissions" ("roleId", "code") WHERE "isDelete" = false`,
    );
    await q.query(
      `CREATE TRIGGER "TRG_role_lms_permissions_updated_at" BEFORE UPDATE ON "role_lms_permissions" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "role_lms_permissions"`);
    await q.query(`ALTER TABLE "roles" DROP CONSTRAINT "CHK_roles_platform"`);
    await q.query(`ALTER TABLE "roles" DROP COLUMN "platform"`);
  }
}
