import type { Express } from 'express';
import { Permission, RolePermission } from '../../../src/database/entities';
import { seedAboutAmrut } from '../../../src/database/seeds/seed-about-amrut';
import { seedAmrutImpact } from '../../../src/database/seeds/seed-amrut-impact';
import { seedAmrutSchemes } from '../../../src/database/seeds/seed-amrut-schemes';
import { seedAnnouncements } from '../../../src/database/seeds/seed-announcements';
import { seedBoardMembers } from '../../../src/database/seeds/seed-board-members';
import { seedContactPage } from '../../../src/database/seeds/seed-contact-page';
import { seedEcosystem } from '../../../src/database/seeds/seed-ecosystem';
import { seedFooter } from '../../../src/database/seeds/seed-footer';
import { seedHomeHero } from '../../../src/database/seeds/seed-home-hero';
import { seedModulesPage } from '../../../src/database/seeds/seed-modules-page';
import { seedProgrammeHighlight } from '../../../src/database/seeds/seed-programme-highlight';
import { seedProgrammePage } from '../../../src/database/seeds/seed-programme-page';
import { seedRbac } from '../../../src/database/seeds/seed-rbac';
import { seedTopBar } from '../../../src/database/seeds/seed-top-bar';
import { seedBrandBar } from '../../../src/database/seeds/seed-brand-bar';
import { ROLE_CODES, WEBSITE_MENUS, rbacService } from '../../../src/modules/roles-permissions';
import {
  API,
  AppDataSource,
  PASSWORD,
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

let app: Express;
let admin: TestActor;
let websiteRoleId: string;

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
  websiteRoleId = await roleId(ROLE_CODES.WEBSITE_ADMIN);
  /* The website's singleton pages, as `npm run seed` creates them. */
  for (const seed of [
    seedContactPage,
    seedFooter,
    seedModulesPage,
    seedHomeHero,
    seedProgrammeHighlight,
    seedBoardMembers,
    seedEcosystem,
    seedAmrutSchemes,
    seedAmrutImpact,
    seedAboutAmrut,
    seedAnnouncements,
    seedTopBar,
    seedBrandBar,
    seedProgrammePage,
  ]) {
    await seed(AppDataSource);
  }
});
afterAll(teardownTestApp);

/* The seeded grant: singleton pages are viewed and edited, list pages and geography masters also add and delete. */
const PAGES = ['cms-contact', 'cms-footer', 'cms-modules', 'cms-brandbar', 'cms-hero', 'cms-highlight', 'cms-programme'];
const LISTS = [
  'cms-faqs',
  'cms-eligibility',
  'cms-apply',
  'cms-announcements',
  'cms-topbar',
  'cms-board',
  'cms-ecosystem',
  'cms-schemes',
  'cms-impact',
  'cms-about',
  'cms-states',
  'cms-districts',
  'cms-talukas',
];
const SEEDED = [
  ...PAGES.flatMap((m) => [`${m}.view`, `${m}.update`]),
  ...LISTS.flatMap((m) => [`${m}.view`, `${m}.create`, `${m}.update`, `${m}.delete`]),
].sort();
const isWebsiteCode = (code: string) => (WEBSITE_MENUS as readonly string[]).includes(code.split('.')[0]);

interface WebsiteAdmin {
  id: string;
  email: string;
  token: string;
}

let seq = 0;
/* Created the way the Users & Roles screen does it: POST /users with the Website Admin role. */
async function createWebsiteAdmin(): Promise<WebsiteAdmin> {
  seq += 1;
  const email = `website.admin${seq}.${Date.now()}@test.local`;
  const res = await request(app)
    .post(`${API}/users`)
    .set(auth(admin.token))
    .send({ name: `Website Admin ${seq}`, email, password: PASSWORD, roleIds: [websiteRoleId] });
  if (res.status !== 201) throw new Error(`createWebsiteAdmin failed (${res.status}): ${JSON.stringify(res.body)}`);
  return { id: res.body.data.id, email, token: await login(email) };
}

const grantedCodes = async (): Promise<string[]> => {
  const res = await request(app).get(`${API}/roles/${websiteRoleId}/permissions`).set(auth(admin.token));
  expect(res.status).toBe(200);
  return (res.body.data as { code: string }[]).map((p) => p.code).sort();
};

const setRolePermissions = async (codes: string[]) => {
  const permissionIds = await Promise.all(codes.map(permissionId));
  return request(app).put(`${API}/roles/${websiteRoleId}/permissions`).set(auth(admin.token)).send({ permissionIds });
};

describe('the Website Admin role', () => {
  it('is seeded as a system role granting only the CMS menu', async () => {
    const res = await request(app).get(`${API}/roles/${websiteRoleId}`).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ code: 'WEBSITE_ADMIN', name: 'Website Admin', isSystem: true, isActive: true });
    expect(await grantedCodes()).toEqual(SEEDED);
  });

  it('cannot be deleted', async () => {
    const res = await request(app).delete(`${API}/roles/${websiteRoleId}`).set(auth(admin.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PROTECTED_ROLE');
  });

  it('refuses permissions outside the CMS menu, and changes nothing', async () => {
    const res = await setRolePermissions(['cms-faqs.view', 'users.view', 'cms-departments.view']);
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { message: string }) => d.message).sort()).toEqual(['cms-departments.view', 'users.view']);
    expect(await grantedCodes()).toEqual(SEEDED);
  });

  it('picks up a menu added after the role was created when the seed runs again', async () => {
    /* As on a database seeded before AMRUT Impact Management existed: the role has never held its codes. */
    await AppDataSource.query(
      `DELETE FROM "role_permissions" WHERE "roleId" = $1 AND "permissionId" IN (SELECT "id" FROM "permissions" WHERE "code" LIKE 'cms-impact.%')`,
      [websiteRoleId],
    );
    expect((await grantedCodes()).filter((c) => c.startsWith('cms-impact.'))).toEqual([]);

    await seedRbac(AppDataSource);
    expect(await grantedCodes()).toEqual(SEEDED);
  });

  it('keeps an administrator’s narrowed permissions when the seed runs again', async () => {
    expect((await setRolePermissions(['cms-faqs.view'])).status).toBe(200);
    await seedRbac(AppDataSource);
    expect(await grantedCodes()).toEqual(['cms-faqs.view']);
    expect((await setRolePermissions(SEEDED)).status).toBe(200);
  });
});

describe('signing in', () => {
  it('a Website Admin signs in with their own account and gets the CMS workspace', async () => {
    const wa = await createWebsiteAdmin();
    const me = await request(app).get(`${API}/auth/me`).set(auth(wa.token));
    expect(me.status).toBe(200);
    expect(me.body.data.portal).toBe('website');
    expect(me.body.data.roles.map((r: { code: string }) => r.code)).toEqual(['WEBSITE_ADMIN']);
    expect([...me.body.data.permissions].sort()).toEqual(SEEDED);
  });

  it('every other account keeps the full panel and its permissions', async () => {
    const me = await request(app).get(`${API}/auth/me`).set(auth(admin.token));
    expect(me.body.data.portal).toBe('admin');
    expect(me.body.data.permissions).toEqual(expect.arrayContaining(['dashboard.view', 'users.view', 'cms-faqs.create']));

    const viewer = await createUser({ roleCodes: ['VIEWER'] });
    const vme = await request(app)
      .get(`${API}/auth/me`)
      .set(auth(await login(viewer.email)));
    expect(vme.body.data.portal).toBe('admin');
    expect(vme.body.data.permissions).toContain('dashboard.view');
    expect(vme.body.data.permissions.some(isWebsiteCode)).toBe(false);
  });
});

describe('CMS operations as a Website Admin', () => {
  let wa: WebsiteAdmin;
  beforeAll(async () => {
    wa = await createWebsiteAdmin();
  });

  it('opens every website screen', async () => {
    const paths = [
      '/cms/contact',
      '/cms/footer',
      '/cms/modules',
      '/cms/hero',
      '/cms/highlight',
      '/cms/board-members',
      '/cms/board-members/settings',
      '/cms/ecosystem',
      '/cms/ecosystem/settings',
      '/cms/schemes',
      '/cms/schemes/settings',
      '/cms/impact',
      '/cms/impact/settings',
      '/cms/about',
      '/cms/programme',
      '/cms/faqs',
      '/cms/eligibility/settings',
      '/cms/apply/settings',
      '/cms/apply/items',
      '/cms/announcements',
      '/cms/announcements/settings',
      '/cms/top-bar',
      '/cms/top-bar/settings',
      '/cms/brand-bar',
      '/cms/states',
      '/cms/districts',
      '/cms/talukas',
    ];
    for (const p of paths) {
      const res = await request(app).get(`${API}${p}`).set(auth(wa.token));
      expect([p, res.status]).toEqual([p, 200]);
    }
  });

  it('adds, edits and deletes an FAQ', async () => {
    const created = await request(app)
      .post(`${API}/cms/faqs`)
      .set(auth(wa.token))
      .send({ question: { mr: 'वेबसाइट प्रश्न?', en: 'Website question?' }, answer: { mr: 'उत्तर.', en: 'Answer.' } });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const updated = await request(app)
      .patch(`${API}/cms/faqs/${id}`)
      .set(auth(wa.token))
      .send({ answer: { mr: 'नवीन उत्तर.', en: 'New answer.' } });
    expect(updated.status).toBe(200);
    expect(updated.body.data.answer.en).toBe('New answer.');
    expect((await request(app).delete(`${API}/cms/faqs/${id}`).set(auth(wa.token))).status).toBe(200);
  });

  it('adds, edits, hides and deletes an announcement, and edits the ticker settings', async () => {
    const created = await request(app)
      .post(`${API}/cms/announcements`)
      .set(auth(wa.token))
      .send({ title: { mr: 'वेबसाइट सूचना', en: 'Website notice' }, link: '/apply' });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const updated = await request(app)
      .patch(`${API}/cms/announcements/${id}`)
      .set(auth(wa.token))
      .send({ detail: { mr: 'तपशील', en: 'Details' } });
    expect(updated.status).toBe(200);
    expect(updated.body.data.detail.en).toBe('Details');
    const hidden = await request(app).patch(`${API}/cms/announcements/${id}/status`).set(auth(wa.token)).send({ isActive: false });
    expect(hidden.status).toBe(200);
    const settings = await request(app)
      .put(`${API}/cms/announcements/settings`)
      .set(auth(wa.token))
      .send({ label: { mr: 'सूचना', en: 'Announcements' }, showSection: true });
    expect(settings.status).toBe(200);
    expect((await request(app).delete(`${API}/cms/announcements/${id}`).set(auth(wa.token))).status).toBe(200);
  });

  it('adds, edits, hides and deletes a Top Bar link, and edits the Top Bar settings', async () => {
    const created = await request(app)
      .post(`${API}/cms/top-bar`)
      .set(auth(wa.token))
      .send({ label: { mr: 'वेबसाइट दुवा', en: 'Website link' }, link: '/apply' });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    const updated = await request(app).patch(`${API}/cms/top-bar/${id}`).set(auth(wa.token)).send({ link: 'www.example.gov.in' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.link).toBe('https://www.example.gov.in');
    const hidden = await request(app).patch(`${API}/cms/top-bar/${id}/status`).set(auth(wa.token)).send({ isActive: false });
    expect(hidden.status).toBe(200);
    const settings = await request(app)
      .put(`${API}/cms/top-bar/settings`)
      .set(auth(wa.token))
      .send({ governmentName: { mr: 'महाराष्ट्र शासन', en: 'Government of Maharashtra' }, showLanguageToggle: true });
    expect(settings.status).toBe(200);
    expect((await request(app).delete(`${API}/cms/top-bar/${id}`).set(auth(wa.token))).status).toBe(200);
  });

  it('edits the singleton pages', async () => {
    const hero = await request(app).patch(`${API}/cms/hero/status`).set(auth(wa.token)).send({ isPublished: true });
    expect(hero.status).toBe(200);
    const contact = await request(app).patch(`${API}/cms/contact/status`).set(auth(wa.token)).send({ isPublished: true });
    expect(contact.status).toBe(200);
  });

  it('manages the geography masters', async () => {
    const created = await request(app).post(`${API}/cms/states`).set(auth(wa.token)).send({ name: 'Website State', code: 'WS' });
    expect(created.status).toBe(201);
    expect((await request(app).delete(`${API}/cms/states/${created.body.data.id}`).set(auth(wa.token))).status).toBe(200);
  });

  it('is denied every other module, including the Masters group served under /cms', async () => {
    const closed: [string, string][] = [
      ['get', '/users'],
      ['post', '/users'],
      ['get', '/roles'],
      ['get', '/permissions'],
      ['get', '/menu-visibility'],
      ['get', '/audit-logs'],
      ['get', '/imports'],
      ['get', '/students'],
      ['get', '/student-registrations'],
      ['get', '/regions'],
      ['get', '/cms/departments'],
      ['get', '/cms/batches'],
      ['get', '/cms/training-centres'],
      ['get', '/lms/entities'],
      ['get', '/lms/courses'],
    ];
    for (const [m, p] of closed) {
      const res = await request(app)[m as 'get' | 'post'](`${API}${p}`).set(auth(wa.token)).send({});
      expect([m, p, res.status]).toEqual([m, p, 403]);
    }
  });

  it('loses exactly what the role loses when an administrator narrows it', async () => {
    expect((await setRolePermissions(['cms-faqs.view', 'cms-faqs.update'])).status).toBe(200);
    expect((await request(app).get(`${API}/cms/faqs`).set(auth(wa.token))).status).toBe(200);
    expect((await request(app).post(`${API}/cms/faqs`).set(auth(wa.token)).send({})).status).toBe(403);
    expect((await request(app).get(`${API}/cms/states`).set(auth(wa.token))).status).toBe(403);
    expect((await setRolePermissions(SEEDED)).status).toBe(200);
    expect((await request(app).get(`${API}/cms/states`).set(auth(wa.token))).status).toBe(200);
  });

  it('ignores a non-CMS grant made outside the API', async () => {
    const usersView = await AppDataSource.getRepository(Permission).findOneOrFail({ where: { code: 'users.view', isDelete: false } });
    const grants = AppDataSource.getRepository(RolePermission);
    await grants.insert({ roleId: websiteRoleId, permissionId: usersView.id });
    rbacService.invalidate();
    try {
      expect((await request(app).get(`${API}/users`).set(auth(wa.token))).status).toBe(403);
      const me = await request(app).get(`${API}/auth/me`).set(auth(wa.token));
      expect(me.body.data.permissions).not.toContain('users.view');
    } finally {
      await grants.delete({ roleId: websiteRoleId, permissionId: usersView.id });
      rbacService.invalidate();
    }
  });
});

describe('managing Website Admins in Users & Roles', () => {
  it('lists them with the role filter', async () => {
    const wa = await createWebsiteAdmin();
    const res = await request(app).get(`${API}/users`).query({ roleId: websiteRoleId, limit: 100 }).set(auth(admin.token));
    expect(res.status).toBe(200);
    const ids = (res.body.data as { id: string }[]).map((u) => u.id);
    expect(ids).toContain(wa.id);
    expect(ids).not.toContain(admin.user.id);
  });

  it('refuses to create a Website Admin who also holds another role, and creates nothing', async () => {
    const email = `combined.${Date.now()}@test.local`;
    const res = await request(app)
      .post(`${API}/users`)
      .set(auth(admin.token))
      .send({ name: 'Combined', email, password: PASSWORD, roleIds: [websiteRoleId, await roleId('VIEWER')] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Website Admin cannot hold any other role/);
    const found = await request(app).get(`${API}/users`).query({ search: email }).set(auth(admin.token));
    expect(found.body.data).toHaveLength(0);
  });

  it('assigns the role to an existing user (replacing their roles) and takes it away again', async () => {
    const user = await createUser({ roleCodes: ['VIEWER'] });
    const both = await request(app)
      .put(`${API}/users/${user.id}/roles`)
      .set(auth(admin.token))
      .send({ roleIds: [websiteRoleId, await roleId('VIEWER')] });
    expect(both.status).toBe(400);

    const assigned = await request(app).put(`${API}/users/${user.id}/roles`).set(auth(admin.token)).send({ roleIds: [websiteRoleId] });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.map((r: { code: string }) => r.code)).toEqual(['WEBSITE_ADMIN']);
    const token = await login(user.email);
    const me = await request(app).get(`${API}/auth/me`).set(auth(token));
    expect(me.body.data.portal).toBe('website');
    expect(me.body.data.permissions).not.toContain('dashboard.view');

    const back = await request(app)
      .put(`${API}/users/${user.id}/roles`)
      .set(auth(admin.token))
      .send({ roleIds: [await roleId('VIEWER')] });
    expect(back.status).toBe(200);
    const after = await request(app).get(`${API}/auth/me`).set(auth(token));
    expect(after.body.data.portal).toBe('admin');
    expect(after.body.data.permissions).toContain('dashboard.view');
  });

  it('edits, deactivates and deletes a Website Admin account', async () => {
    const wa = await createWebsiteAdmin();
    const edited = await request(app).patch(`${API}/users/${wa.id}`).set(auth(admin.token)).send({ name: 'Renamed Website Admin' });
    expect(edited.status).toBe(200);
    expect(edited.body.data.name).toBe('Renamed Website Admin');

    expect((await request(app).patch(`${API}/users/${wa.id}/status`).set(auth(admin.token)).send({ isActive: false })).status).toBe(200);
    expect((await request(app).post(`${API}/auth/login`).send({ email: wa.email, password: PASSWORD })).status).toBe(401);
    expect((await request(app).get(`${API}/cms/faqs`).set(auth(wa.token))).status).toBe(401);

    expect((await request(app).patch(`${API}/users/${wa.id}/status`).set(auth(admin.token)).send({ isActive: true })).status).toBe(200);
    expect((await request(app).delete(`${API}/users/${wa.id}`).set(auth(admin.token))).status).toBe(200);
    expect((await request(app).post(`${API}/auth/login`).send({ email: wa.email, password: PASSWORD })).status).toBe(401);
  });

  it('only an actor holding every CMS permission can hand out the role', async () => {
    const director = await createUser({ roleCodes: ['PROJECT_DIRECTOR'] });
    const userAdmin = await createUser();
    const role = await request(app)
      .post(`${API}/roles`)
      .set(auth(admin.token))
      .send({ name: 'User admin', code: 'TEST_USER_ADMIN', permissionIds: await Promise.all(['users.view', 'users.assign-roles'].map(permissionId)) });
    expect(role.status).toBe(201);
    await request(app).put(`${API}/users/${userAdmin.id}/roles`).set(auth(admin.token)).send({ roleIds: [role.body.data.id] });
    const res = await request(app)
      .put(`${API}/users/${director.id}/roles`)
      .set(auth(await login(userAdmin.email)))
      .send({ roleIds: [websiteRoleId] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PRIVILEGE_ESCALATION');
  });
});
