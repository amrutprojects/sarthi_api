import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * The IPP officer roles (Divisional Officer, COEP, Head Officer) work in the Applications screen of IPP Approvals only
 * (RbacService rule 8, docs/ipp-approvals.md). The seed grants them nothing else, but Roles & Permissions could: such a
 * grant gave an officer other menus and the APIs behind them. From now on the API refuses those grants and drops them
 * from an officer account's effective permissions; this migration removes the ones an existing database already has,
 * so the Roles & Permissions screen shows what the roles really grant.
 *
 * A grant of one of these roles to a permission outside the `ipp-approvals` menu is soft-deleted (isDelete, as
 * replacing a role's permissions does). The `ipp-approvals.*` grants and every other role are untouched. Idempotent:
 * a soft-deleted grant no longer matches. down() restores nothing: a removed grant is one the API now refuses.
 */
const OFFICER_ROLES = `'DIVISIONAL_OFFICER', 'COEP', 'HEAD_OFFICER'`;

export class IppOfficerRolesScope1799100000000 implements MigrationInterface {
  name = 'IppOfficerRolesScope1799100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE "role_permissions" rp
         SET "isDelete" = true, "isActive" = false
        FROM "roles" r, "permissions" p
       WHERE rp."roleId" = r."id"
         AND rp."permissionId" = p."id"
         AND rp."isDelete" = false
         AND r."code" IN (${OFFICER_ROLES})
         AND split_part(p."code", '.', 1) <> 'ipp-approvals'`);
  }

  public async down(): Promise<void> {
    /* no-op by design: the removed grants are refused by the API now */
  }
}
