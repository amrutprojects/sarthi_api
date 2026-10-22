import { In, type DataSource, type EntityManager } from 'typeorm';
import { ALL_PERMISSIONS, LEGACY_CODE_MAP } from '../../modules/roles-permissions';
import { ROLES } from '../../modules/roles-permissions';
import { Permission } from '../../modules/roles-permissions';
import { RolePermission } from '../../modules/roles-permissions';
import { Role } from '../../modules/roles-permissions';

export interface SeedSummary {
  permissionsCreated: number;
  permissionsUpdated: number;
  rolesCreated: number;
  grantsCreated: number;
  permissionsRetired: number;
}

/*
 * Idempotent RBAC seed (safe to run any number of times, in one transaction):
 * - Permissions: upserted by code among non-deleted rows. Name / module / description are refreshed;
 *   isActive and soft-deleted rows are left alone (an admin's deactivation is respected).
 * - Roles: created by code if missing. Existing roles are not modified.
 * - Grants: a newly created role receives its default permissions. SUPER_ADMIN ('ALL') is re-synced
 *   on every run so it always holds every catalogue permission. Grants of existing non-system roles
 *   are not touched, so permissions customised through the API survive re-seeding.
 */
export async function seedRbac(ds: DataSource): Promise<SeedSummary> {
  return ds.transaction(async (m: EntityManager) => {
    const summary: SeedSummary = { permissionsCreated: 0, permissionsUpdated: 0, rolesCreated: 0, grantsCreated: 0, permissionsRetired: 0 };
    const permRepo = m.getRepository(Permission);
    const roleRepo = m.getRepository(Role);
    const grantRepo = m.getRepository(RolePermission);

    /*
     * Codes that have ever had a row, soft-deleted ones included. The carry-over below runs only for a code seen
     * for the first time: a code an admin deleted is re-created for the catalogue (and SUPER_ADMIN), but its
     * holders are not re-granted it, so the deletion sticks.
     */
    const everExisted = new Set(
      (await permRepo.find({ where: { code: In(ALL_PERMISSIONS.map((d) => d.code)) }, select: { code: true } })).map((p) => p.code),
    );

    const byCode = new Map<string, Permission>();
    for (const def of ALL_PERMISSIONS) {
      let p = await permRepo.findOne({ where: { code: def.code, isDelete: false } });
      if (!p) {
        p = await permRepo.save(permRepo.create({ ...def }));
        summary.permissionsCreated++;
      } else if (p.name !== def.name || p.module !== def.module || p.description !== def.description) {
        await permRepo.update(p.id, { name: def.name, module: def.module, description: def.description });
        summary.permissionsUpdated++;
      }
      byCode.set(def.code, p);
    }

    /* Earlier catalogue → menu codes, once (see LEGACY_CODE_MAP). */
    for (const [oldCode, { retire, to }] of Object.entries(LEGACY_CODE_MAP)) {
      const old = await permRepo.findOne({ where: { code: oldCode, isDelete: false } });
      if (!old) continue;
      /*
       * An inactive source grants nothing, so it passes nothing on: a retired code hands over no grants, and the
       * first-time counterparts of a kept code start inactive, so an admin's deactivation carries over with them.
       */
      const targetCodes = retire ? (old.isActive ? to : []) : to.filter((c) => !everExisted.has(c));
      const targets = targetCodes.map((c) => byCode.get(c)).filter((x): x is Permission => !!x);
      if (!retire && !old.isActive && targets.length) {
        await permRepo.update({ id: In(targets.map((t) => t.id)) }, { isActive: false });
      }
      const holders = await grantRepo.find({ where: { permissionId: old.id, isDelete: false } });
      for (const g of holders) {
        const have = new Set((await grantRepo.find({ where: { roleId: g.roleId, isDelete: false } })).map((x) => x.permissionId));
        const add = targets.filter((t) => !have.has(t.id));
        if (add.length) {
          await grantRepo.insert(add.map((t) => ({ roleId: g.roleId, permissionId: t.id })));
          summary.grantsCreated += add.length;
        }
      }
      if (retire) {
        await grantRepo.update({ permissionId: old.id, isDelete: false }, { isDelete: true, isActive: false });
        await permRepo.update(old.id, { isDelete: true, isActive: false });
        summary.permissionsRetired++;
      }
    }

    for (const def of ROLES) {
      let role = await roleRepo.findOne({ where: { code: def.code, isDelete: false } });
      const created = !role;
      if (!role) {
        role = await roleRepo.save(
          roleRepo.create({ code: def.code, name: def.name, description: def.description, isSystem: def.isSystem }),
        );
        summary.rolesCreated++;
      }
      if (!created && def.permissions !== 'ALL') continue;

      const except = new Set(def.exceptModules ?? []);
      const codes =
        def.permissions === 'ALL' ? [...byCode.values()].filter((p) => !except.has(p.module)).map((p) => p.code) : def.permissions;
      const existing = await grantRepo.find({ where: { roleId: role.id, isDelete: false } });
      const have = new Set(existing.map((g) => g.permissionId));
      const missing = codes.map((c) => byCode.get(c)).filter((p): p is Permission => !!p && !have.has(p.id));
      if (missing.length) {
        await grantRepo.insert(missing.map((p) => ({ roleId: role!.id, permissionId: p.id })));
        summary.grantsCreated += missing.length;
      }
    }
    return summary;
  });
}
