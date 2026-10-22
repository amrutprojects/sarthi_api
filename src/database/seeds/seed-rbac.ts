import type { DataSource, EntityManager } from 'typeorm';
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
 *   isActive and soft-deleted rows are left alone (an admin's deactivation is respected, and a deactivated
 *   legacy code moves no grants to its replacements).
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

    const byCode = new Map<string, Permission>();
    const createdNow = new Set<string>();
    for (const def of ALL_PERMISSIONS) {
      let p = await permRepo.findOne({ where: { code: def.code, isDelete: false } });
      if (!p) {
        p = await permRepo.save(permRepo.create({ ...def }));
        createdNow.add(def.code);
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
      /* A deactivated code grants nothing, so its holders get no replacements (a retired one is still soft-deleted below). */
      const targets = !old.isActive
        ? []
        : (retire ? to : to.filter((c) => createdNow.has(c))).map((c) => byCode.get(c)).filter((x): x is Permission => !!x);
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
