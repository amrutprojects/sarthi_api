import type { MigrationInterface, QueryRunner } from 'typeorm';

/* Per-role sidebar menu visibility (no row = visible). */
export class RoleMenuVisibility1792100000000 implements MigrationInterface {
  name = 'RoleMenuVisibility1792100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "role_menu_visibility" (
        "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "isDelete"  boolean     NOT NULL DEFAULT false,
        "isActive"  boolean     NOT NULL DEFAULT true,
        "roleId"    uuid        NOT NULL,
        "menuKey"   varchar(64) NOT NULL,
        "isVisible" boolean     NOT NULL DEFAULT true,
        CONSTRAINT "PK_role_menu_visibility" PRIMARY KEY ("id"),
        CONSTRAINT "FK_role_menu_visibility_role" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_role_menu_visibility_active" ON "role_menu_visibility" ("roleId", "menuKey") WHERE "isDelete" = false`);
    await q.query(`CREATE TRIGGER "TRG_role_menu_visibility_updated_at" BEFORE UPDATE ON "role_menu_visibility" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "role_menu_visibility"`);
  }
}
