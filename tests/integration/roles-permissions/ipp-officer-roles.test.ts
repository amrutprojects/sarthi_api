import type { Express } from 'express';
import { IppOfficerRolesScope1799100000000 } from '../../../src/database/migrations/1799100000000-IppOfficerRolesScope';
import { Permission, RolePermission } from '../../../src/database/entities';
import { seedRbac } from '../../../src/database/seeds/seed-rbac';
import { IPP_OFFICER_ROLES, ROLE_CODES, rbacService } from '../../../src/modules/roles-permissions';
import { signedIn } from '../../helpers/ipp';
import {
  API,
  AppDataSource,
  auth,
  createUser,
  login,
  permissionId,
  request,
  roleId,
  setupTestApp,
  superAdmin,
  teardownTestApp,
  type TestActor,
} from '../../helpers/test-app';

/*
 * The IPP officer roles (Divisional Officer, COEP, Head Officer) work in the Applications screen of IPP Approvals only
 * (RbacService rule 8): portal 'ipp', only `ipp-approvals.*` permissions, every other module refused, and Roles &
 * Permissions cannot give them more. Migration 1799100000000 removes such grants from an existing database.
 */
let app: Express;
let admin: TestActor;

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
});
afterAll(teardownTestApp);

const SEEDED: Record<string, string[]> = {
  DIVISIONAL_OFFICER: ['ipp-approvals.division-officer', 'ipp-approvals.view'],
  COEP: ['ipp-approvals.coep', 'ipp-approvals.view'],
  HEAD_OFFICER: ['ipp-approvals.head-office', 'ipp-approvals.view'],
};

const grantedCodes = async (code: string): Promise<string[]> => {
  const res = await request(app)
    .get(`${API}/roles/${await roleId(code)}/permissions`)
    .set(auth(admin.token));
  expect(res.status).toBe(200);
  return (res.body.data as { code: string }[]).map((p) => p.code).sort();
};

const me = async (token: string) => {
  const res = await request(app).get(`${API}/auth/me`).set(auth(token));
  expect(res.status).toBe(200);
  return res.body.data as { portal: string; permissions: string[]; hiddenMenus: string[] };
};

/* A grant written straight into the database (not through the API), as an old or hand-edited database may have. */
async function grantOutsideApi(roleCode: string, permissionCode: string): Promise<() => Promise<void>> {
  const permission = await AppDataSource.getRepository(Permission).findOneOrFail({ where: { code: permissionCode, isDelete: false } });
  const grants = AppDataSource.getRepository(RolePermission);
  const role = await roleId(roleCode);
  await grants.insert({ roleId: role, permissionId: permission.id });
  rbacService.invalidate();
  return async () => {
    await grants.delete({ roleId: role, permissionId: permission.id });
    rbacService.invalidate();
  };
}

describe.each(IPP_OFFICER_ROLES.map((code) => [code]))('the %s role', (code) => {
  let officer: TestActor;
  beforeAll(async () => {
    officer = await signedIn([code]);
  });

  it('is seeded with the IPP Approvals permissions only', async () => {
    expect(await grantedCodes(code)).toEqual(SEEDED[code]);
  });

  it('signs in to the IPP workspace with only IPP Approvals permissions and nothing hidden to hide', async () => {
    const data = await me(officer.token);
    expect(data.portal).toBe('ipp');
    expect([...data.permissions].sort()).toEqual(SEEDED[code]);
  });

  it('opens the Applications screen’s APIs', async () => {
    for (const p of [
      '/ipp-approvals/summary',
      '/ipp-approvals/applications',
      '/ipp-approvals/batches',
      '/ipp-approvals/districts',
      '/ipp-approvals/head-office',
    ]) {
      const res = await request(app).get(`${API}${p}`).set(auth(officer.token));
      expect([p, res.status]).toEqual([p, 200]);
    }
  });

  it('is refused every other module, the Divisional Officer Mapping and the IPP link settings included', async () => {
    const closed = [
      '/users',
      '/roles',
      '/permissions',
      '/menu-visibility',
      '/audit-logs',
      '/imports',
      '/students',
      '/student-registrations',
      '/regions',
      '/cms/faqs',
      '/cms/contact',
      '/cms/departments',
      '/lms/entities',
      '/ipp-approvals/officers',
      '/ipp-approvals/link',
    ];
    for (const p of closed) {
      const res = await request(app).get(`${API}${p}`).set(auth(officer.token));
      expect([p, res.status]).toEqual([p, 403]);
    }
  });

  it('cannot be given a permission outside IPP Approvals in Roles & Permissions, and nothing changes', async () => {
    const id = await roleId(code);
    const wanted = await Promise.all([...SEEDED[code], 'dashboard.view', 'cms-faqs.view'].map(permissionId));
    const res = await request(app).put(`${API}/roles/${id}/permissions`).set(auth(admin.token)).send({ permissionIds: wanted });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/can only hold permissions of the IPP Approvals menu/);
    expect(res.body.error.details.map((d: { message: string }) => d.message).sort()).toEqual(['cms-faqs.view', 'dashboard.view']);
    expect(await grantedCodes(code)).toEqual(SEEDED[code]);

    /* IPP Approvals codes are still accepted. */
    const kept = await request(app)
      .put(`${API}/roles/${id}/permissions`)
      .set(auth(admin.token))
      .send({ permissionIds: await Promise.all(SEEDED[code].map(permissionId)) });
    expect(kept.status).toBe(200);
  });

  it('ignores a grant outside IPP Approvals made in the database', async () => {
    const undo = await grantOutsideApi(code, 'users.view');
    try {
      expect((await request(app).get(`${API}/users`).set(auth(officer.token))).status).toBe(403);
      expect((await me(officer.token)).permissions).not.toContain('users.view');
    } finally {
      await undo();
    }
  });
});

describe('accounts with an IPP officer role and another role', () => {
  it('several officer roles together still get the IPP workspace', async () => {
    const both = await signedIn([ROLE_CODES.DIVISIONAL_OFFICER, ROLE_CODES.COEP]);
    const data = await me(both.token);
    expect(data.portal).toBe('ipp');
    expect([...data.permissions].sort()).toEqual(['ipp-approvals.coep', 'ipp-approvals.division-officer', 'ipp-approvals.view']);
  });

  it('an officer who also holds another role keeps that role’s panel and permissions', async () => {
    const viewer = await signedIn([ROLE_CODES.COEP, 'VIEWER']);
    const data = await me(viewer.token);
    expect(data.portal).toBe('admin');
    expect(data.permissions).toEqual(expect.arrayContaining(['dashboard.view', 'ipp-approvals.coep', 'ipp-approvals.view']));
  });

  it('an officer whose other role is deactivated works in the IPP workspace only', async () => {
    const role = await request(app)
      .post(`${API}/roles`)
      .set(auth(admin.token))
      .send({ name: 'Temporary extra role', code: 'TEST_TEMP_EXTRA', permissionIds: [await permissionId('users.view')] });
    expect(role.status).toBe(201);
    const user = await createUser({ roleCodes: [ROLE_CODES.HEAD_OFFICER, 'TEST_TEMP_EXTRA'] });
    const token = await login(user.email);
    expect((await me(token)).portal).toBe('admin');

    expect(
      (await request(app).patch(`${API}/roles/${role.body.data.id}/status`).set(auth(admin.token)).send({ isActive: false })).status,
    ).toBe(200);
    const after = await me(token);
    expect(after.portal).toBe('ipp');
    expect(after.permissions).not.toContain('users.view');
  });

  it('every other account keeps its workspace', async () => {
    expect((await me(admin.token)).portal).toBe('admin');
    const viewer = await signedIn(['VIEWER']);
    expect((await me(viewer.token)).portal).toBe('admin');
    const pmo = await signedIn(['PMO']);
    expect((await me(pmo.token)).permissions).toContain('dashboard.view');
  });
});

describe('migration 1799100000000-IppOfficerRolesScope', () => {
  const runMigration = async () => {
    const qr = AppDataSource.createQueryRunner();
    try {
      await new IppOfficerRolesScope1799100000000().up(qr);
    } finally {
      await qr.release();
    }
    rbacService.invalidate();
  };

  it('removes the officer roles’ grants outside IPP Approvals and keeps every other grant', async () => {
    const undoCoep = await grantOutsideApi(ROLE_CODES.COEP, 'dashboard.view');
    const undoHead = await grantOutsideApi(ROLE_CODES.HEAD_OFFICER, 'cms-faqs.view');
    const viewerBefore = await grantedCodes('VIEWER');
    const pmoBefore = await grantedCodes('PMO');
    try {
      expect(await grantedCodes(ROLE_CODES.COEP)).toContain('dashboard.view');
      await runMigration();
      for (const code of IPP_OFFICER_ROLES) expect(await grantedCodes(code)).toEqual(SEEDED[code]);
      expect(await grantedCodes('VIEWER')).toEqual(viewerBefore);
      expect(await grantedCodes('PMO')).toEqual(pmoBefore);

      /* Idempotent, and the seed does not hand the removed grants back. */
      await runMigration();
      await seedRbac(AppDataSource);
      for (const code of IPP_OFFICER_ROLES) expect(await grantedCodes(code)).toEqual(SEEDED[code]);
    } finally {
      /* The soft-deleted rows stay as history; nothing active to undo. */
      await undoCoep().catch(() => undefined);
      await undoHead().catch(() => undefined);
    }
  });
});
