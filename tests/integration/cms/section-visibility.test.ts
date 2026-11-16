import type { Express } from 'express';
import {
  AppDataSource,
  API,
  actorWith,
  auth,
  request,
  setupTestApp,
  superAdmin,
  teardownTestApp,
  type TestActor,
} from '../../helpers/test-app';
import { auditService } from '../../../src/modules/audit/audit.service';
import { seedTopBar } from '../../../src/database/seeds/seed-top-bar';
import { seedBrandBar } from '../../../src/database/seeds/seed-brand-bar';
import { seedAnnouncements } from '../../../src/database/seeds/seed-announcements';
import { seedHomeHero } from '../../../src/database/seeds/seed-home-hero';
import { seedProgrammeHighlight } from '../../../src/database/seeds/seed-programme-highlight';
import { seedBoardMembers } from '../../../src/database/seeds/seed-board-members';
import { seedAmrutImpact } from '../../../src/database/seeds/seed-amrut-impact';
import { seedEcosystem } from '../../../src/database/seeds/seed-ecosystem';
import { seedAmrutSchemes } from '../../../src/database/seeds/seed-amrut-schemes';
import { seedAboutAmrut } from '../../../src/database/seeds/seed-about-amrut';

const URL = `${API}/cms/section-visibility`;

let app: Express;
let admin: TestActor;

interface Item {
  key: string;
  menu: string;
  visible: boolean;
  configured: boolean;
  updatedAt: string | null;
}
interface Detail {
  field: string;
  message: string;
}

/* The admin panel's HOME_PAGE_TABS order. */
const KEYS = ['top-bar', 'brand-bar', 'announcements', 'hero', 'glance', 'diploma', 'board', 'impact', 'ecosystem', 'schemes', 'about'];

/* Each switch: its menu, the column it drives, and where the website reads it. */
const SECTIONS: Record<string, { menu: string; table: string; column: string; feed: string; flag: string }> = {
  'top-bar': { menu: 'cms-topbar', table: 'top_bar_settings', column: 'showSection', feed: '/public/top-bar', flag: 'showSection' },
  'brand-bar': { menu: 'cms-brandbar', table: 'brand_bar_settings', column: 'showSection', feed: '/public/brand-bar', flag: 'showSection' },
  announcements: {
    menu: 'cms-announcements',
    table: 'announcement_settings',
    column: 'showSection',
    feed: '/public/announcements',
    flag: 'showSection',
  },
  hero: { menu: 'cms-hero', table: 'home_hero', column: 'isPublished', feed: '/public/hero', flag: 'showSection' },
  glance: { menu: 'cms-hero', table: 'home_hero', column: 'showGlance', feed: '/public/hero', flag: 'showGlance' },
  diploma: { menu: 'cms-highlight', table: 'programme_highlight', column: 'isPublished', feed: '/public/highlight', flag: 'showSection' },
  board: { menu: 'cms-board', table: 'board_section', column: 'showSection', feed: '/public/board-members', flag: 'showSection' },
  impact: { menu: 'cms-impact', table: 'impact_section', column: 'showSection', feed: '/public/impact', flag: 'showSection' },
  ecosystem: { menu: 'cms-ecosystem', table: 'ecosystem_section', column: 'showSection', feed: '/public/ecosystem', flag: 'showSection' },
  schemes: { menu: 'cms-schemes', table: 'amrut_schemes_section', column: 'showSection', feed: '/public/schemes', flag: 'showSection' },
  about: { menu: 'cms-about', table: 'about_section', column: 'showSection', feed: '/public/about', flag: 'showSection' },
};

/* The list each section's feed empties while hidden, so the website is never sent content it must not show. */
const HIDDEN_LISTS: Record<string, string> = {
  'top-bar': 'links',
  announcements: 'items',
  hero: 'slides',
  diploma: 'objectives',
  board: 'members',
  impact: 'stats',
  ecosystem: 'programmes',
  schemes: 'schemes',
  about: 'cards',
};

const details = (res: { body: { error: { details: Detail[] } } }) => res.body.error.details;
const list = async (token = admin.token): Promise<Item[]> => (await request(app).get(URL).set(auth(token)).expect(200)).body.data;
const set = (key: string, payload: unknown, token = admin.token) =>
  request(app)
    .put(`${URL}/${key}`)
    .set(auth(token))
    .send(payload as object);
const feed = async (path: string) => (await request(app).get(`${API}${path}`).expect(200)).body.data as Record<string, unknown>;
const column = async (table: string, name: string): Promise<boolean> =>
  (await AppDataSource.query(`SELECT "${name}" AS v FROM "${table}" WHERE "isDelete" = false`))[0].v as boolean;
const auditCount = async () =>
  (await AppDataSource.query(`SELECT count(*)::int AS n FROM "audit_logs" WHERE "action" = 'cms.section-visibility.update'`))[0]
    .n as number;

/* resetData() empties most section tables, so every section this file switches is seeded here. */
beforeAll(async () => {
  app = await setupTestApp();
  for (const seed of [
    seedTopBar,
    seedBrandBar,
    seedAnnouncements,
    seedHomeHero,
    seedProgrammeHighlight,
    seedBoardMembers,
    seedAmrutImpact,
    seedEcosystem,
    seedAmrutSchemes,
    seedAboutAmrut,
  ]) {
    await seed(AppDataSource);
  }
  admin = await superAdmin();
});
/* programme_highlight survives resetData() for the other test files, so it is left shown. */
afterAll(async () => {
  await AppDataSource.query(`UPDATE "programme_highlight" SET "isPublished" = true WHERE "isDelete" = false`);
  await teardownTestApp();
});
afterEach(() => jest.restoreAllMocks());

describe('Listing the switches', () => {
  it('lists every section, in tab order, with its menu, flag and version — all shown after the seed', async () => {
    const items = await list();
    expect(items.map((i) => i.key)).toEqual(KEYS);
    for (const i of items) {
      expect(Object.keys(i).sort()).toEqual(['configured', 'key', 'menu', 'updatedAt', 'visible']);
      expect(i).toMatchObject({ menu: SECTIONS[i.key]!.menu, visible: true, configured: true });
      expect(new Date(i.updatedAt!).toISOString()).toBe(i.updatedAt);
    }
  });

  it("lists only the sections whose tab the user may open (the menu's view permission)", async () => {
    const some = await actorWith(['cms-topbar.view', 'cms-hero.view', 'cms-about.update']);
    expect((await list(some.token)).map((i) => i.key)).toEqual(['top-bar', 'hero', 'glance']);

    const none = await actorWith(['dashboard.view']);
    expect(await list(none.token)).toEqual([]);
  });

  it('needs a session', async () => {
    expect((await request(app).get(URL)).status).toBe(401);
    expect((await request(app).put(`${URL}/top-bar`).send({ visible: false })).status).toBe(401);
  });
});

describe('Switching a section', () => {
  it.each(KEYS)('%s: flips only its own column, the public feed carries the flag, and switching back restores it', async (key) => {
    const s = SECTIONS[key]!;
    const before = (await list()).find((i) => i.key === key)!;

    const off = await set(key, { visible: false });
    expect(off.status).toBe(200);
    expect(off.body.message).toBe('Section hidden from the website');
    expect(off.body.data).toMatchObject({ key, menu: s.menu, visible: false, configured: true });
    expect(new Date(off.body.data.updatedAt).getTime()).toBeGreaterThan(new Date(before.updatedAt!).getTime());
    expect(await column(s.table, s.column)).toBe(false);

    /* Hidden is never null — null means "not configured", which the website answers with its bundled copy. */
    const hidden = await feed(s.feed);
    expect(hidden).not.toBeNull();
    expect(hidden[s.flag]).toBe(false);
    if (HIDDEN_LISTS[key]) expect(hidden[HIDDEN_LISTS[key]!]).toEqual([]);
    /* The hero row carries two switches; each leaves the other alone. */
    if (key === 'hero') expect(hidden).toMatchObject({ showGlance: true });
    if (key === 'glance') expect(hidden).toMatchObject({ showSection: true });
    expect((await list()).find((i) => i.key === key)).toMatchObject({ visible: false });

    const on = await set(key, { visible: true });
    expect(on.status).toBe(200);
    expect(on.body.message).toBe('Section shown on the website');
    expect(on.body.data).toMatchObject({ key, visible: true, configured: true });
    expect(await column(s.table, s.column)).toBe(true);
    expect((await feed(s.feed))[s.flag]).toBe(true);
  });

  it('the glance card hides on its own, and the banner hides the card with it', async () => {
    await set('glance', { visible: false }).expect(200);
    expect(await feed('/public/hero')).toMatchObject({ showSection: true, showGlance: false });
    expect(((await feed('/public/hero')).slides as unknown[]).length).toBeGreaterThan(0);
    await set('hero', { visible: false }).expect(200);
    expect(await feed('/public/hero')).toMatchObject({ showSection: false, showGlance: false, slides: [] });
    /* The admin hero screen reports both flags. */
    expect((await request(app).get(`${API}/cms/hero`).set(auth(admin.token)).expect(200)).body.data).toMatchObject({
      isPublished: false,
      showGlance: false,
    });
    await set('hero', { visible: true }).expect(200);
    await set('glance', { visible: true }).expect(200);
  });

  it('is idempotent: setting the current value succeeds and leaves the row and its version alone', async () => {
    const first = (await set('brand-bar', { visible: false }).expect(200)).body.data as Item;
    const again = (await set('brand-bar', { visible: false }).expect(200)).body.data as Item;
    expect(again).toEqual(first);
    await set('brand-bar', { visible: true }).expect(200);
  });

  it('records who switched which section, in the same transaction as the change', async () => {
    const before = await auditCount();
    await set('impact', { visible: false }).expect(200);
    expect(await auditCount()).toBe(before + 1);
    const [entry] = await AppDataSource.query(
      `SELECT "resource", "resourceId", "outcome", "details", "actorUserId" FROM "audit_logs"
        WHERE "action" = 'cms.section-visibility.update' ORDER BY "createdAt" DESC LIMIT 1`,
    );
    expect(entry).toMatchObject({
      resource: 'section-visibility',
      resourceId: 'impact',
      actorUserId: admin.user.id,
      details: { key: 'impact', visible: false },
    });

    /* No audit, no change: a failed audit write rolls the flag back. */
    jest.spyOn(auditService, 'recordInTx').mockRejectedValueOnce(new Error('simulated database failure'));
    expect((await set('impact', { visible: true })).status).toBe(500);
    expect(await column('impact_section', 'showSection')).toBe(false);

    await set('impact', { visible: true }).expect(200);
  });

  it("leaves the section's own settings alone, and a settings page opened before the switch must reload", async () => {
    const settings = (await request(app).get(`${API}/cms/top-bar/settings`).set(auth(admin.token)).expect(200)).body.data;
    expect(settings.showSection).toBe(true);
    await set('top-bar', { visible: false }).expect(200);

    const stale = await request(app).put(`${API}/cms/top-bar/settings`).set(auth(admin.token)).send({
      governmentName: settings.governmentName,
      showLanguageToggle: false,
      expectedUpdatedAt: settings.updatedAt,
    });
    expect(stale.status).toBe(409);

    /* A fresh save of the settings keeps the strip hidden: the switch is the one writer of the flag. */
    const saved = await request(app)
      .put(`${API}/cms/top-bar/settings`)
      .set(auth(admin.token))
      .send({ governmentName: settings.governmentName, showLanguageToggle: settings.showLanguageToggle });
    expect(saved.status).toBe(200);
    expect(saved.body.data.showSection).toBe(false);
    expect(await feed('/public/top-bar')).toMatchObject({ showSection: false, links: [] });
    const viaSettings = await request(app)
      .put(`${API}/cms/top-bar/settings`)
      .set(auth(admin.token))
      .send({ governmentName: settings.governmentName, showLanguageToggle: true, showSection: true });
    expect(viaSettings.status).toBe(422);

    await set('top-bar', { visible: true }).expect(200);
    expect(((await feed('/public/top-bar')).links as unknown[]).length).toBeGreaterThan(0);
  });
});

describe('Refusals', () => {
  it("needs the section's own update permission (403), whatever else the user holds", async () => {
    const heroEditor = await actorWith(['cms-hero.view', 'cms-hero.update', 'cms-highlight.view', 'cms-topbar.update']);
    await set('hero', { visible: false }, heroEditor.token).expect(200);
    await set('glance', { visible: false }, heroEditor.token).expect(200);
    await set('hero', { visible: true }, heroEditor.token).expect(200);
    await set('glance', { visible: true }, heroEditor.token).expect(200);
    /* Viewing the programme band is not editing it. */
    expect((await set('diploma', { visible: false }, heroEditor.token)).status).toBe(403);
    expect(await column('programme_highlight', 'isPublished')).toBe(true);

    const viewer = await actorWith(['cms-board.view']);
    const denied = await set('board', { visible: false }, viewer.token);
    expect(denied.status).toBe(403);
    expect(await column('board_section', 'showSection')).toBe(true);
    const [{ n }] = await AppDataSource.query(
      `SELECT count(*)::int AS n FROM "audit_logs" WHERE "action" = 'authz.denied' AND "actorUserId" = $1`,
      [viewer.user.id],
    );
    expect(n).toBe(1);
  });

  it('refuses an unknown section or a bad body with 422 naming the field', async () => {
    const unknown = await set('footer', { visible: false });
    expect(unknown.status).toBe(422);
    expect(details(unknown).map((d) => d.field)).toEqual(['params.key']);

    const extra = await set('about', { visible: false, showSection: false });
    expect(extra.status).toBe(422);
    expect(details(extra).map((d) => d.field)).toEqual(['body']);

    const notBoolean = await set('about', { visible: 'no' });
    expect(notBoolean.status).toBe(422);
    expect(details(notBoolean)).toEqual([{ field: 'body.visible', message: 'visible must be true or false' }]);

    const missing = await set('about', {});
    expect(details(missing)).toEqual([{ field: 'body.visible', message: 'visible is required' }]);
    expect(await column('about_section', 'showSection')).toBe(true);
  });

  it('a section that is not configured reads as visible but switch-less, and a change is a 404', async () => {
    await AppDataSource.query(`UPDATE "brand_bar_settings" SET "isDelete" = true`);
    try {
      expect((await list()).find((i) => i.key === 'brand-bar')).toEqual({
        key: 'brand-bar',
        menu: 'cms-brandbar',
        visible: true,
        configured: false,
        updatedAt: null,
      });
      const before = await auditCount();
      const res = await set('brand-bar', { visible: false });
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('This section has not been configured yet. Run the database seed to create it.');
      expect(await auditCount()).toBe(before);
    } finally {
      await AppDataSource.query(`UPDATE "brand_bar_settings" SET "isDelete" = false`);
    }
    expect((await list()).find((i) => i.key === 'brand-bar')).toMatchObject({ configured: true, visible: true });
  });
});
