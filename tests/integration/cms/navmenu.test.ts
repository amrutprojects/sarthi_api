import type { Express } from 'express';
import {
  AppDataSource,
  API,
  actorWith,
  auth,
  createUser,
  login,
  request,
  setupTestApp,
  superAdmin,
  teardownTestApp,
  type TestActor,
} from '../../helpers/test-app';
import { auditService } from '../../../src/modules/audit/audit.service';
import { ROLE_CODES } from '../../../src/modules/roles-permissions';

const ADMIN_URL = `${API}/cms/nav-menu`;
const PUBLIC_URL = `${API}/public/nav-menu`;

let app: Express;
let admin: TestActor;

interface Label {
  mr: string;
  en: string;
}
interface Item {
  key: string;
  show: boolean;
  label: Label | null;
  updatedAt: string | null;
}
interface Detail {
  field: string;
  message: string;
}

/* The website's menu bar, in order, then its Login / Register button. */
const KEYS = ['home', 'about', 'programme', 'advisory', 'modules', 'eligibility', 'apply', 'faq', 'contact', 'login'];
const ALL_SHOWN = KEYS.map((key) => ({ key, show: true, label: null }));

const details = (res: { body: { error: { details: Detail[] } } }) => res.body.error.details;
const list = async (token = admin.token): Promise<Item[]> => (await request(app).get(ADMIN_URL).set(auth(token)).expect(200)).body.data;
const item = async (key: string) => (await list()).find((i) => i.key === key)!;
const set = (key: string, payload: unknown, token = admin.token) =>
  request(app)
    .put(`${ADMIN_URL}/${key}`)
    .set(auth(token))
    .send(payload as object);
const publicItems = async () =>
  (await request(app).get(PUBLIC_URL).expect(200)).body.data.items as { key: string; show: boolean; label: Label | null }[];
const liveRows = async (key: string) =>
  (await AppDataSource.query(`SELECT "showOnWebsite" AS show FROM "nav_menu_items" WHERE "key" = $1 AND "isDelete" = false`, [key])) as {
    show: boolean;
  }[];
const liveNames = async (key: string) =>
  (await AppDataSource.query(`SELECT "labelMr" AS mr, "labelEn" AS en FROM "nav_menu_items" WHERE "key" = $1 AND "isDelete" = false`, [
    key,
  ])) as Label[];
const auditCount = async () =>
  (await AppDataSource.query(`SELECT count(*)::int AS n FROM "audit_logs" WHERE "action" = 'cms.nav-menu.update'`))[0].n as number;

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
});
/* nav_menu_items survives resetData() (its rows come from the migration), so every item is left with a live, shown, default-named row. */
afterAll(async () => {
  await AppDataSource.query(
    `INSERT INTO "nav_menu_items" ("key") SELECT unnest($1::varchar[])
     ON CONFLICT ("key") WHERE "isDelete" = false
     DO UPDATE SET "showOnWebsite" = true, "labelMr" = '', "labelEn" = ''
     WHERE "nav_menu_items"."showOnWebsite" = false OR "nav_menu_items"."labelMr" <> '' OR "nav_menu_items"."labelEn" <> ''`,
    [KEYS],
  );
  await teardownTestApp();
});
afterEach(() => jest.restoreAllMocks());

describe('Listing the menu', () => {
  it('the migration creates every item, shown, so the list is all ten in menu order with their versions', async () => {
    const items = await list();
    expect(items.map((i) => i.key)).toEqual(KEYS);
    for (const i of items) {
      expect(Object.keys(i).sort()).toEqual(['key', 'label', 'show', 'updatedAt']);
      expect(i.show).toBe(true);
      expect(i.label).toBeNull();
      expect(new Date(i.updatedAt!).toISOString()).toBe(i.updatedAt);
      expect(await liveRows(i.key)).toEqual([{ show: true }]);
    }
  });

  it('the public feed needs no session and lists every item, shown, in menu order', async () => {
    const res = await request(app).get(PUBLIC_URL);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ items: ALL_SHOWN });
  });
});

describe('Hiding and showing an item', () => {
  it('hiding takes the item out of the public feed only; showing brings it back', async () => {
    const before = await item('advisory');
    const off = await set('advisory', { show: false });
    expect(off.status).toBe(200);
    expect(off.body.message).toBe('Menu item hidden from the website');
    expect(off.body.data).toMatchObject({ key: 'advisory', show: false });
    expect(new Date(off.body.data.updatedAt).getTime()).toBeGreaterThan(new Date(before.updatedAt!).getTime());
    expect(await liveRows('advisory')).toEqual([{ show: false }]);
    expect(await publicItems()).toEqual(KEYS.map((key) => ({ key, show: key !== 'advisory', label: null })));
    expect(await item('advisory')).toEqual(off.body.data);

    const on = await set('advisory', { show: true });
    expect(on.status).toBe(200);
    expect(on.body.message).toBe('Menu item shown on the website');
    expect(on.body.data).toMatchObject({ key: 'advisory', show: true });
    expect(await publicItems()).toEqual(ALL_SHOWN);
  });

  it('hides several items at once, the Login / Register button included', async () => {
    await set('home', { show: false }).expect(200);
    await set('login', { show: false }).expect(200);
    expect((await publicItems()).filter((i) => !i.show).map((i) => i.key)).toEqual(['home', 'login']);
    expect((await list()).filter((i) => !i.show).map((i) => i.key)).toEqual(['home', 'login']);
    await set('home', { show: true }).expect(200);
    await set('login', { show: true }).expect(200);
    expect(await publicItems()).toEqual(ALL_SHOWN);
  });

  it('is idempotent: setting the current value succeeds, leaves the row and its version alone, and is audited', async () => {
    const audits = await auditCount();
    const first = (await set('faq', { show: false }).expect(200)).body.data as Item;
    const again = (await set('faq', { show: false }).expect(200)).body.data as Item;
    expect(again).toEqual(first);
    expect(await liveRows('faq')).toEqual([{ show: false }]);
    expect(await auditCount()).toBe(audits + 2);
    await set('faq', { show: true }).expect(200);
  });

  it('an item whose row is missing reads as shown, and a change creates its row', async () => {
    await AppDataSource.query(`DELETE FROM "nav_menu_items" WHERE "key" = 'contact'`);
    expect(await item('contact')).toEqual({ key: 'contact', show: true, label: null, updatedAt: null });
    expect(await publicItems()).toEqual(ALL_SHOWN);

    const off = await set('contact', { show: false });
    expect(off.status).toBe(200);
    expect(off.body.data).toMatchObject({ key: 'contact', show: false });
    expect(off.body.data.updatedAt).not.toBeNull();
    expect(await liveRows('contact')).toEqual([{ show: false }]);
    expect((await publicItems()).find((i) => i.key === 'contact')).toEqual({ key: 'contact', show: false, label: null });

    await set('contact', { show: true }).expect(200);
    expect(await liveRows('contact')).toEqual([{ show: true }]);
  });

  it('a soft-deleted row no longer counts: the item reads as shown, and a change creates a new live row', async () => {
    await set('modules', { show: false }).expect(200);
    await AppDataSource.query(`UPDATE "nav_menu_items" SET "isDelete" = true WHERE "key" = 'modules'`);
    expect(await item('modules')).toEqual({ key: 'modules', show: true, label: null, updatedAt: null });
    expect(await publicItems()).toEqual(ALL_SHOWN);

    const off = await set('modules', { show: false });
    expect(off.status).toBe(200);
    expect(await liveRows('modules')).toEqual([{ show: false }]);
    await set('modules', { show: true }).expect(200);
    expect(await liveRows('modules')).toEqual([{ show: true }]);
  });

  it('records who switched which item, in the same transaction as the change', async () => {
    const before = await auditCount();
    await set('about', { show: false }).expect(200);
    expect(await auditCount()).toBe(before + 1);
    const [entry] = await AppDataSource.query(
      `SELECT "resource", "resourceId", "details", "actorUserId" FROM "audit_logs"
        WHERE "action" = 'cms.nav-menu.update' ORDER BY "createdAt" DESC LIMIT 1`,
    );
    expect(entry).toEqual({
      resource: 'nav-menu',
      resourceId: 'about',
      actorUserId: admin.user.id,
      details: { key: 'about', show: false },
    });

    /* No audit, no change: a failed audit write rolls the flag back. */
    jest.spyOn(auditService, 'recordInTx').mockRejectedValueOnce(new Error('simulated database failure'));
    expect((await set('about', { show: true })).status).toBe(500);
    expect(await liveRows('about')).toEqual([{ show: false }]);

    await set('about', { show: true }).expect(200);
    expect(await publicItems()).toEqual(ALL_SHOWN);
  });
});

describe('Naming an item', () => {
  const FAQ = { mr: 'नेहमीचे प्रश्न', en: 'Questions' };

  it('sets a custom name in both languages, trimmed; the list and the public feed carry it and the flag is untouched', async () => {
    const before = await item('faq');
    const res = await set('faq', { label: { mr: `  ${FAQ.mr} `, en: ` ${FAQ.en}  ` } });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Menu item name saved');
    expect(res.body.data).toMatchObject({ key: 'faq', show: true, label: FAQ });
    expect(new Date(res.body.data.updatedAt).getTime()).toBeGreaterThan(new Date(before.updatedAt!).getTime());
    expect(await liveNames('faq')).toEqual([FAQ]);
    expect(await liveRows('faq')).toEqual([{ show: true }]);
    expect(await item('faq')).toEqual(res.body.data);
    expect(await publicItems()).toEqual(KEYS.map((key) => ({ key, show: true, label: key === 'faq' ? FAQ : null })));

    await set('faq', { label: null }).expect(200);
    expect(await publicItems()).toEqual(ALL_SHOWN);
  });

  it('a show-only change keeps the name, a name-only change keeps the flag, and both can change at once', async () => {
    await set('apply', { label: { mr: 'अर्ज', en: 'Apply' } }).expect(200);
    const off = (await set('apply', { show: false }).expect(200)).body.data as Item;
    expect(off).toMatchObject({ show: false, label: { mr: 'अर्ज', en: 'Apply' } });

    const renamed = (await set('apply', { label: { mr: 'अर्ज करा', en: 'Apply now' } }).expect(200)).body.data as Item;
    expect(renamed).toMatchObject({ show: false, label: { mr: 'अर्ज करा', en: 'Apply now' } });

    const both = await set('apply', { show: true, label: null });
    expect(both.status).toBe(200);
    expect(both.body.message).toBe('Menu item updated');
    expect(both.body.data).toMatchObject({ key: 'apply', show: true, label: null });
    expect(await liveNames('apply')).toEqual([{ mr: '', en: '' }]);
    expect(await publicItems()).toEqual(ALL_SHOWN);
  });

  it('resets to the default name with null or with both halves blank', async () => {
    await set('contact', { label: { mr: 'संपर्क साधा', en: 'Reach us' } }).expect(200);
    const reset = await set('contact', { label: null });
    expect(reset.status).toBe(200);
    expect(reset.body.message).toBe('Menu item name reset to the default');
    expect(reset.body.data).toMatchObject({ key: 'contact', show: true, label: null });
    expect(await liveNames('contact')).toEqual([{ mr: '', en: '' }]);

    await set('contact', { label: { mr: 'संपर्क साधा', en: 'Reach us' } }).expect(200);
    const blank = await set('contact', { label: { mr: '   ', en: '' } });
    expect(blank.status).toBe(200);
    expect(blank.body.data.label).toBeNull();
    expect(await liveNames('contact')).toEqual([{ mr: '', en: '' }]);
    expect(await publicItems()).toEqual(ALL_SHOWN);
  });

  it('keeps a name on one line, and takes exactly 40 characters', async () => {
    const res = await set('home', { label: { mr: 'मुख्य\nपान', en: 'Home\r\n\tpage' } });
    expect(res.status).toBe(200);
    expect(res.body.data.label).toEqual({ mr: 'मुख्य पान', en: 'Home page' });

    const longest = { mr: 'अ'.repeat(40), en: 'x'.repeat(40) };
    expect((await set('home', { label: longest }).expect(200)).body.data.label).toEqual(longest);
    expect(await liveNames('home')).toEqual([longest]);
    await set('home', { label: null }).expect(200);
  });

  it('is idempotent: saving the same name succeeds, leaves the row and its version alone, and is audited', async () => {
    const audits = await auditCount();
    const name = { mr: 'मॉड्यूल', en: 'Courses' };
    const first = (await set('modules', { label: name }).expect(200)).body.data as Item;
    const again = (await set('modules', { label: name }).expect(200)).body.data as Item;
    expect(again).toEqual(first);
    expect(await auditCount()).toBe(audits + 2);
    await set('modules', { label: null }).expect(200);
  });

  it('renames the Login / Register button, creating its row (shown) when it is missing', async () => {
    await AppDataSource.query(`DELETE FROM "nav_menu_items" WHERE "key" = 'login'`);
    const name = { mr: 'प्रवेश', en: 'Sign in' };
    const res = await set('login', { label: name });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ key: 'login', show: true, label: name });
    expect(res.body.data.updatedAt).not.toBeNull();
    expect(await liveRows('login')).toEqual([{ show: true }]);
    expect(await liveNames('login')).toEqual([name]);
    expect((await publicItems()).find((i) => i.key === 'login')).toEqual({ key: 'login', show: true, label: name });
    await set('login', { label: null }).expect(200);
  });

  it('records which fields were sent in the audit entry', async () => {
    const name = { mr: 'अमृत कलश योजना', en: 'The Programme' };
    await set('programme', { label: name }).expect(200);
    await set('programme', { show: false, label: null }).expect(200);
    const entries = (await AppDataSource.query(
      `SELECT "details" FROM "audit_logs" WHERE "action" = 'cms.nav-menu.update' AND "resourceId" = 'programme'
        ORDER BY "createdAt" DESC LIMIT 2`,
    )) as { details: unknown }[];
    expect(entries.map((e) => e.details)).toEqual([
      { key: 'programme', show: false, label: null },
      { key: 'programme', label: name },
    ]);
    await set('programme', { show: true }).expect(200);
    expect(await publicItems()).toEqual(ALL_SHOWN);
  });
});

describe('Refusals', () => {
  it('refuses a name in one language only, too long, with control characters or of the wrong shape, and changes nothing', async () => {
    const enMissing = await set('home', { label: { mr: 'मुख्य', en: '  ' } });
    expect(enMissing.status).toBe(422);
    expect(details(enMissing)).toEqual([{ field: 'body.label.en', message: 'Name (English) is required when the Marathi text is filled in' }]);

    const mrMissing = await set('home', { label: { mr: '', en: 'Start' } });
    expect(mrMissing.status).toBe(422);
    expect(details(mrMissing)).toEqual([{ field: 'body.label.mr', message: 'Name (Marathi) is required when the English text is filled in' }]);

    const tooLong = await set('home', { label: { mr: 'अ'.repeat(41), en: 'x'.repeat(41) } });
    expect(tooLong.status).toBe(422);
    expect(details(tooLong)).toEqual([
      { field: 'body.label.mr', message: 'Name (Marathi) must be at most 40 characters' },
      { field: 'body.label.en', message: 'Name (English) must be at most 40 characters' },
    ]);

    const control = await set('home', { label: { mr: 'मुख्य\u0007', en: 'Start' } });
    expect(control.status).toBe(422);
    expect(details(control)).toEqual([{ field: 'body.label.mr', message: 'Name (Marathi) contains characters that are not allowed' }]);

    const notPair = await set('home', { label: 'Start' });
    expect(notPair.status).toBe(422);
    expect(details(notPair)).toEqual([{ field: 'body.label', message: 'Name must have Marathi and English text' }]);

    const extra = await set('home', { label: { mr: 'मुख्य', en: 'Start', hi: 'x' } });
    expect(extra.status).toBe(422);
    expect(details(extra).map((d) => d.field)).toEqual(['body.label']);

    const halfKey = await set('home', { label: { en: 'Start' } });
    expect(halfKey.status).toBe(422);
    expect(details(halfKey).map((d) => d.field)).toEqual(['body.label.mr']);

    const badShowWithName = await set('home', { show: 'no', label: { mr: 'मुख्य', en: 'Start' } });
    expect(badShowWithName.status).toBe(422);
    expect(details(badShowWithName).map((d) => d.field)).toEqual(['body.show']);

    expect(await liveNames('home')).toEqual([{ mr: '', en: '' }]);
    expect(await publicItems()).toEqual(ALL_SHOWN);
  });

  it('refuses an unknown item or a bad body with 422 naming the field, and changes nothing', async () => {
    const unknown = await set('footer', { show: false });
    expect(unknown.status).toBe(422);
    expect(details(unknown).map((d) => d.field)).toEqual(['params.key']);

    const extra = await set('home', { show: false, key: 'about' });
    expect(extra.status).toBe(422);
    expect(details(extra).map((d) => d.field)).toEqual(['body']);

    const notBoolean = await set('home', { show: 'no' });
    expect(notBoolean.status).toBe(422);
    expect(details(notBoolean)).toEqual([{ field: 'body.show', message: 'show must be true or false' }]);

    const empty = await set('home', {});
    expect(empty.status).toBe(422);
    expect(details(empty)).toEqual([{ field: 'body', message: 'Send show, label or both' }]);

    expect(await publicItems()).toEqual(ALL_SHOWN);
  });

  it('the database refuses an unknown key or a second live row for a key, even past the API', async () => {
    await expect(AppDataSource.query(`INSERT INTO "nav_menu_items" ("key") VALUES ('footer')`)).rejects.toThrow(/CHK_nav_menu_items_key/);
    await expect(AppDataSource.query(`INSERT INTO "nav_menu_items" ("key") VALUES ('home')`)).rejects.toThrow(
      /UQ_nav_menu_items_key_active/,
    );
  });

  it('the database refuses a name filled in one language only, even past the API', async () => {
    await expect(AppDataSource.query(`UPDATE "nav_menu_items" SET "labelMr" = 'मुख्य' WHERE "key" = 'home'`)).rejects.toThrow(
      /CHK_nav_menu_items_label_pair/,
    );
    await expect(
      AppDataSource.query(`UPDATE "nav_menu_items" SET "labelMr" = '  ', "labelEn" = 'Start' WHERE "key" = 'home'`),
    ).rejects.toThrow(/CHK_nav_menu_items_label_pair/);
    expect(await liveNames('home')).toEqual([{ mr: '', en: '' }]);
  });
});

describe('Access control', () => {
  it('refuses the admin routes without a session', async () => {
    expect((await request(app).get(ADMIN_URL)).status).toBe(401);
    expect((await request(app).put(`${ADMIN_URL}/home`).send({ show: false })).status).toBe(401);
  });

  it('a view-only administrator can read but not change an item', async () => {
    const viewer = await actorWith(['cms-navmenu.view']);
    expect((await list(viewer.token)).map((i) => i.key)).toEqual(KEYS);
    expect((await set('home', { show: false }, viewer.token)).status).toBe(403);
    expect((await set('home', { label: { mr: 'मुख्य', en: 'Start' } }, viewer.token)).status).toBe(403);
    expect(await liveRows('home')).toEqual([{ show: true }]);
    expect(await liveNames('home')).toEqual([{ mr: '', en: '' }]);
  });

  it('another CMS permission does not open the menu', async () => {
    const brandBar = await actorWith(['cms-brandbar.view', 'cms-brandbar.update']);
    expect((await request(app).get(ADMIN_URL).set(auth(brandBar.token))).status).toBe(403);
    expect((await set('home', { show: false }, brandBar.token)).status).toBe(403);
  });

  it('a Website Admin reads and changes it', async () => {
    const user = await createUser({ roleCodes: [ROLE_CODES.WEBSITE_ADMIN] });
    const token = await login(user.email);
    expect((await list(token)).map((i) => i.key)).toEqual(KEYS);
    await set('eligibility', { show: false }, token).expect(200);
    await set('eligibility', { show: true }, token).expect(200);
    expect(await publicItems()).toEqual(ALL_SHOWN);
  });
});
