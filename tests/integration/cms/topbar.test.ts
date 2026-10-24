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
import { seedTopBar } from '../../../src/database/seeds/seed-top-bar';
import { auditService } from '../../../src/modules/audit/audit.service';
import { ROLE_CODES } from '../../../src/modules/roles-permissions';

const ADMIN_URL = `${API}/cms/top-bar`;
const PUBLIC_URL = `${API}/public/top-bar`;

let app: Express;
let admin: TestActor;

interface Pair {
  mr: string;
  en: string;
}
interface AdminLink {
  id: string;
  label: Pair;
  link: string;
  displayOrder: number;
  isActive: boolean;
  updatedAt: string;
}
interface PublicLink {
  label: Pair;
  link: string;
}
interface PublicFeed {
  governmentName: Pair | null;
  showLanguageToggle: boolean;
  links: PublicLink[];
}
interface AdminSettings {
  id: string;
  governmentName: Pair;
  showLanguageToggle: boolean;
  updatedAt: string;
}
interface Detail {
  field: string;
  message: string;
}

const pair = (mr: string, en: string): Pair => ({ mr, en });
const BLANK = pair('', '');
/* What the website's strip carried before it was managed (STR.govt, STR.verifyCert, STR.checkStatus), word for word. */
const GOVERNMENT = pair('महाराष्ट्र शासन', 'Government of Maharashtra');
const VERIFY = pair('प्रमाणपत्र पडताळणी', 'Verify Certificate');
const STATUS = pair('अर्जाची स्थिती पहा', 'Check Application Status');

const DESTINATION_HELP = 'Destination must be a page on this site starting with /, or a web address starting with https:// or www.';
const PAGE_HELP = 'A page on this site must start with a single / and use only letters, digits and - _ . ~ / ? = & % #';

const linkBody = (n: number, extra: Record<string, unknown> = {}) => ({
  label: pair(`चाचणी दुवा ${n}`, `Test link ${n}`),
  link: `/test-${n}`,
  ...extra,
});

const details = (res: { body: { error: { details: Detail[] } } }) => res.body.error.details;
const list = async (): Promise<AdminLink[]> => (await request(app).get(ADMIN_URL).set(auth(admin.token)).expect(200)).body.data;
const publicFeed = async () => (await request(app).get(PUBLIC_URL).expect(200)).body.data as PublicFeed | null;
const publicLinks = async () => (await publicFeed())!.links;
const create = (payload: unknown, token = admin.token) =>
  request(app)
    .post(ADMIN_URL)
    .set(auth(token))
    .send(payload as object);
const patch = (id: string, payload: unknown) =>
  request(app)
    .patch(`${ADMIN_URL}/${id}`)
    .set(auth(admin.token))
    .send(payload as object);
const putSettings = (payload: unknown) =>
  request(app)
    .put(`${ADMIN_URL}/settings`)
    .set(auth(admin.token))
    .send(payload as object);
const getSettings = async (): Promise<AdminSettings> =>
  (await request(app).get(`${ADMIN_URL}/settings`).set(auth(admin.token)).expect(200)).body.data;
const get = async (id: string): Promise<AdminLink> =>
  (await request(app).get(`${ADMIN_URL}/${id}`).set(auth(admin.token)).expect(200)).body.data;
const countRows = async () =>
  (await AppDataSource.query(`SELECT count(*)::int AS n FROM "top_bar_links" WHERE "isDelete" = false`))[0].n as number;

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
});
afterAll(teardownTestApp);
afterEach(() => jest.restoreAllMocks());

describe('Top Bar — before the seed', () => {
  it('the public feed is null while the Top Bar is not configured, so the website keeps its bundled strip', async () => {
    expect(await publicFeed()).toBeNull();
    expect((await request(app).get(`${ADMIN_URL}/settings`).set(auth(admin.token))).status).toBe(404);
    expect((await putSettings({ governmentName: GOVERNMENT, showLanguageToggle: true })).status).toBe(404);
    expect(await list()).toEqual([]);
  });
});

describe('Top Bar seed', () => {
  it('seeds the government name, the language switch and exactly the two links the strip showed, in order', async () => {
    expect(await seedTopBar(AppDataSource)).toEqual({ created: true, linksCreated: 2 });
    const rows = await list();
    expect(rows.map(({ label, link, displayOrder, isActive }) => ({ label, link, displayOrder, isActive }))).toEqual([
      { label: VERIFY, link: '/verify', displayOrder: 1, isActive: true },
      { label: STATUS, link: '/track', displayOrder: 2, isActive: true },
    ]);

    expect(await getSettings()).toMatchObject({ governmentName: GOVERNMENT, showLanguageToggle: true });

    expect(await publicFeed()).toEqual({
      governmentName: GOVERNMENT,
      showLanguageToggle: true,
      links: [
        { label: VERIFY, link: '/verify' },
        { label: STATUS, link: '/track' },
      ],
    });
  });

  it('is idempotent and never brings back a deleted link', async () => {
    const [verify, status] = await list();
    await request(app).delete(`${ADMIN_URL}/${verify!.id}`).set(auth(admin.token)).expect(200);
    await request(app).delete(`${ADMIN_URL}/${status!.id}`).set(auth(admin.token)).expect(200);
    expect(await seedTopBar(AppDataSource)).toEqual({ created: false, linksCreated: 0 });
    expect(await list()).toEqual([]);
    expect(await publicFeed()).toEqual({ governmentName: GOVERNMENT, showLanguageToggle: true, links: [] });
    /* Put the two links back for the rest of the suite, as new records. */
    await create({ label: VERIFY, link: '/verify' }).expect(201);
    await create({ label: STATUS, link: '/track' }).expect(201);
  });
});

describe('Adding a link', () => {
  it('adds at the end, trims the text, keeps Marathi intact and keeps every label on one line', async () => {
    const res = await create({ label: pair('  नोंदणी   सुरू ', 'Register\n  now'), link: '/apply' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      label: pair('नोंदणी सुरू', 'Register now'),
      link: '/apply',
      isActive: true,
      displayOrder: 3,
    });
    const links = await publicLinks();
    expect(links).toHaveLength(3);
    expect(links[2]).toEqual({ label: pair('नोंदणी सुरू', 'Register now'), link: '/apply' });
  });

  it('takes an external address and a page with a query string', async () => {
    const external = (await create(linkBody(1, { link: 'https://example.gov.in/notice?id=7' })).expect(201)).body.data;
    expect(external).toMatchObject({ link: 'https://example.gov.in/notice?id=7' });
    const page = (await create(linkBody(2, { link: '/apply?x=1#top' })).expect(201)).body.data;
    expect(page).toMatchObject({ link: '/apply?x=1#top' });
    const links = await publicLinks();
    expect(links.find((l) => l.label.en === 'Test link 1')).toEqual({
      label: pair('चाचणी दुवा 1', 'Test link 1'),
      link: 'https://example.gov.in/notice?id=7',
    });
  });

  it('takes an address typed as www. and stores it with https://', async () => {
    const res = await create(linkBody(3, { link: ' www.example.gov.in/notice ' })).expect(201);
    expect(res.body.data).toMatchObject({ link: 'https://www.example.gov.in/notice' });
    expect((await patch(res.body.data.id, { link: 'WWW.mahadbt.gov.in' })).body.data).toMatchObject({ link: 'https://WWW.mahadbt.gov.in' });
    /* The website receives the normalised address, ready to put in an href. */
    expect((await publicLinks()).find((l) => l.label.en === 'Test link 3')!.link).toBe('https://WWW.mahadbt.gov.in');
  });

  it('adds a hidden link that the website does not show', async () => {
    const hidden = (await create(linkBody(4, { isActive: false, displayOrder: 50 })).expect(201)).body.data as AdminLink;
    expect(hidden).toMatchObject({ isActive: false, displayOrder: 50 });
    expect((await publicLinks()).map((l) => l.label.en)).not.toContain('Test link 4');
    expect((await list()).map((r) => r.id)).toContain(hidden.id);
  });

  it('replays a double-submitted form (same Idempotency-Key) instead of adding the link twice', async () => {
    const KEY = 'top-bar-test-key-0005';
    const before = await countRows();
    const send = () => create(linkBody(5)).set('Idempotency-Key', KEY);
    const first = await send();
    expect(first.status).toBe(201);
    /* Wait for the first response to be recorded, as a real retry after a lost response would, then expect the replay. */
    for (let i = 0; i < 100; i++) {
      const [row] = await AppDataSource.query(`SELECT "statusCode" FROM "idempotency_keys" WHERE "key" = $1`, [KEY]);
      if (row?.statusCode) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const second = await send();
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await countRows()).toBe(before + 1);
  });
});

describe('Validation', () => {
  it('names each missing field: a link needs a label and a destination', async () => {
    const res = await create({});
    expect(res.status).toBe(422);
    expect(
      details(res)
        .map((d) => d.field)
        .sort(),
    ).toEqual(['body.label', 'body.link']);
    expect(details(res)).toContainEqual({ field: 'body.label', message: 'Label is required' });
    expect(details(res)).toContainEqual({ field: 'body.link', message: 'Destination is required' });
  });

  it('refuses blank halves and over-long labels', async () => {
    const res = await create({ label: pair('   ', 'x'.repeat(41)), link: '/verify' });
    expect(res.status).toBe(422);
    expect(details(res)).toEqual(
      expect.arrayContaining([
        { field: 'body.label.mr', message: 'Label (Marathi) is required' },
        { field: 'body.label.en', message: 'Label (English) must be at most 40 characters' },
      ]),
    );
    const english = await create({ label: pair('फक्त मराठी', ''), link: '/verify' });
    expect(details(english)).toEqual([{ field: 'body.label.en', message: 'Label (English) is required' }]);
  });

  it('accepts a label of exactly 40 characters', async () => {
    const res = await create({ label: pair('म'.repeat(40), 'e'.repeat(40)), link: '/verify' });
    expect(res.status).toBe(201);
    await request(app).delete(`${ADMIN_URL}/${res.body.data.id}`).set(auth(admin.token)).expect(200);
  });

  it.each([
    ['', 'Destination is required'],
    ['   ', 'Destination is required'],
    ['javascript:alert(1)', DESTINATION_HELP],
    ['data:text/html,hi', DESTINATION_HELP],
    ['ftp://example.gov.in/file', DESTINATION_HELP],
    ['//evil.example.com', PAGE_HELP],
    ['/apply"><script>', PAGE_HELP],
    ['apply', DESTINATION_HELP],
    ['https://user:pw@example.gov.in', 'The address must not contain a user name or password'],
    ['https://exa mple.gov.in', 'The address contains characters that are not allowed'],
    ['https://localhost/x', 'Enter a full address, e.g. https://example.gov.in'],
    [`/${'a'.repeat(500)}`, 'Destination must be at most 500 characters'],
  ])('refuses the link %j', async (link, message) => {
    const res = await create(linkBody(7, { link }));
    expect(res.status).toBe(422);
    expect(details(res)).toEqual([{ field: 'body.link', message }]);
  });

  it('refuses a link set to null: a Top Bar link always has a destination', async () => {
    const res = await create(linkBody(7, { link: null }));
    expect(res.status).toBe(422);
    expect(details(res)).toEqual([{ field: 'body.link', message: 'Destination must be text' }]);
  });

  it('refuses unknown fields, a non-boolean status, a label that is not a pair and a link that is not text', async () => {
    const res = await create(linkBody(7, { isActive: 'yes', label: 'text', link: 42, html: '<b>x</b>' }));
    expect(res.status).toBe(422);
    expect(
      details(res)
        .map((d) => d.field)
        .sort(),
    ).toEqual(['body', 'body.isActive', 'body.label', 'body.link']);
    expect(details(res)).toEqual(
      expect.arrayContaining([
        { field: 'body.link', message: 'Destination must be text' },
        { field: 'body.label', message: 'Label must have Marathi and English text' },
        { field: 'body.isActive', message: 'Status must be true or false' },
      ]),
    );
  });

  it('answers 422 for a malformed id and 404 for an unknown one', async () => {
    expect((await request(app).get(`${ADMIN_URL}/nope`).set(auth(admin.token))).status).toBe(422);
    const unknown = '00000000-0000-4000-8000-000000000000';
    expect((await request(app).get(`${ADMIN_URL}/${unknown}`).set(auth(admin.token))).status).toBe(404);
    expect((await patch(unknown, { link: '/apply' })).status).toBe(404);
    expect((await request(app).patch(`${ADMIN_URL}/${unknown}/status`).set(auth(admin.token)).send({ isActive: false })).status).toBe(404);
    expect((await request(app).delete(`${ADMIN_URL}/${unknown}`).set(auth(admin.token))).status).toBe(404);
  });

  it('the database itself refuses an unsafe or missing link, a blank label and a half-filled government name', async () => {
    const insert = (labelMr: string, labelEn: string, link: string | null) =>
      AppDataSource.query(`INSERT INTO "top_bar_links" ("labelMr", "labelEn", "link", "displayOrder") VALUES ($1, $2, $3, 1)`, [
        labelMr,
        labelEn,
        link,
      ]);
    await expect(insert('अ', 'A', 'javascript:alert(1)')).rejects.toThrow(/CHK_top_bar_links_link/);
    await expect(insert('अ', 'A', '//evil.example.com')).rejects.toThrow(/CHK_top_bar_links_link/);
    await expect(insert('अ', 'A', 'apply')).rejects.toThrow(/CHK_top_bar_links_link/);
    await expect(insert('अ', 'A', null)).rejects.toThrow(/null value in column "link"/);
    await expect(insert('  ', 'A', '/verify')).rejects.toThrow(/CHK_top_bar_links_label_mr/);
    await expect(insert('अ', '', '/verify')).rejects.toThrow(/CHK_top_bar_links_label_en/);
    /* The seeded name is filled in both languages, so blanking one half leaves it half-filled. */
    await expect(AppDataSource.query(`UPDATE "top_bar_settings" SET "governmentNameMr" = '  '`)).rejects.toThrow(
      /CHK_top_bar_settings_governmentName_pair/,
    );
  });
});

describe('Editing a link', () => {
  let a: AdminLink;
  beforeAll(async () => {
    a = (await create(linkBody(10, { link: '/faq' })).expect(201)).body.data;
  });

  it('changes only the fields sent', async () => {
    const res = await patch(a.id, { link: '/eligibility' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ label: a.label, link: '/eligibility', displayOrder: a.displayOrder });
    a = res.body.data;
  });

  it('updates label and link together, and the website follows', async () => {
    const res = await patch(a.id, {
      label: pair('सुधारित दुवा', 'Updated link'),
      link: 'https://example.gov.in/updated',
      expectedUpdatedAt: a.updatedAt,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ label: pair('सुधारित दुवा', 'Updated link'), link: 'https://example.gov.in/updated' });
    expect((await publicLinks()).find((l) => l.label.en === 'Updated link')).toEqual({
      label: pair('सुधारित दुवा', 'Updated link'),
      link: 'https://example.gov.in/updated',
    });
    a = await get(a.id);
  });

  it('an empty edit changes nothing', async () => {
    const res = await patch(a.id, {});
    expect(res.status).toBe(200);
    expect(await get(a.id)).toEqual(a);
  });

  it('refuses a save over a newer version, and changes nothing', async () => {
    const res = await patch(a.id, { link: '/apply', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' });
    expect(res.status).toBe(409);
    expect(await get(a.id)).toEqual(a);
  });

  it('keeps the saved link when the database save fails', async () => {
    jest.spyOn(auditService, 'recordInTx').mockRejectedValueOnce(new Error('simulated database failure'));
    const res = await patch(a.id, { label: pair('टिकू नये', 'Must not stick'), link: '/apply' });
    expect(res.status).toBe(500);
    expect(await get(a.id)).toEqual(a);
  });

  it('keeps the saved link when an invalid edit is refused', async () => {
    expect((await patch(a.id, { label: pair('', ''), link: 'javascript:alert(1)' })).status).toBe(422);
    expect((await patch(a.id, { link: null })).status).toBe(422);
    expect((await patch(a.id, { link: '  ' })).status).toBe(422);
    expect(await get(a.id)).toEqual(a);
  });

  it('a hidden link leaves the website and comes back when shown', async () => {
    const hidden = await request(app).patch(`${ADMIN_URL}/${a.id}/status`).set(auth(admin.token)).send({ isActive: false });
    expect(hidden.status).toBe(200);
    expect(hidden.body.message).toBe('Top Bar link hidden from the website');
    expect(hidden.body.data.isActive).toBe(false);
    expect((await publicLinks()).map((l) => l.label.en)).not.toContain('Updated link');
    const shown = await request(app).patch(`${ADMIN_URL}/${a.id}/status`).set(auth(admin.token)).send({ isActive: true });
    expect(shown.status).toBe(200);
    expect(shown.body.message).toBe('Top Bar link shown on the website');
    expect((await publicLinks()).map((l) => l.label.en)).toContain('Updated link');
  });
});

describe('Deleting and ordering', () => {
  it('deletes only the chosen link: soft-deleted, gone from the website, the rest untouched', async () => {
    const a = (await create(linkBody(20)).expect(201)).body.data as AdminLink;
    const others = (await list()).filter((x) => x.id !== a.id);
    const res = await request(app).delete(`${ADMIN_URL}/${a.id}`).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Top Bar link deleted successfully');
    expect(await list()).toEqual(others);
    expect((await publicLinks()).map((l) => l.label.en)).not.toContain('Test link 20');
    const [row] = await AppDataSource.query(`SELECT "isDelete", "isActive" FROM "top_bar_links" WHERE "id" = $1`, [a.id]);
    expect(row).toEqual({ isDelete: true, isActive: false });
    expect((await request(app).delete(`${ADMIN_URL}/${a.id}`).set(auth(admin.token))).status).toBe(404);
    expect((await request(app).get(`${ADMIN_URL}/${a.id}`).set(auth(admin.token))).status).toBe(404);
  });

  it('reorders by id — the website follows, active ones only — and refuses a stale or duplicated list', async () => {
    const rows = await list();
    const reversed = rows.map((r) => r.id).reverse();
    const res = await request(app).put(`${ADMIN_URL}/order`).set(auth(admin.token)).send({ ids: reversed });
    expect(res.status).toBe(200);
    expect((res.body.data as AdminLink[]).map((r) => [r.id, r.displayOrder])).toEqual(reversed.map((id, i) => [id, i + 1]));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect((await publicLinks()).map((l) => l.label.en)).toEqual(
      reversed
        .map((id) => byId.get(id)!)
        .filter((r) => r.isActive)
        .map((r) => r.label.en),
    );
    expect(
      (
        await request(app)
          .put(`${ADMIN_URL}/order`)
          .set(auth(admin.token))
          .send({ ids: reversed.slice(1) })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .put(`${ADMIN_URL}/order`)
          .set(auth(admin.token))
          .send({ ids: [reversed[0], reversed[0]] })
      ).status,
    ).toBe(422);
    expect((await request(app).put(`${ADMIN_URL}/order`).set(auth(admin.token)).send({ ids: [] })).status).toBe(422);
  });
});

describe('Top Bar settings', () => {
  it('updates the government name and the language switch, keeping the links', async () => {
    const current = await getSettings();
    const res = await putSettings({
      governmentName: pair('  महाराष्ट्र   शासन  ', 'Government   of Maharashtra'),
      showLanguageToggle: false,
      expectedUpdatedAt: current.updatedAt,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ governmentName: GOVERNMENT, showLanguageToggle: false });
    const before = await publicLinks();
    const feed = (await publicFeed())!;
    expect(feed).toEqual({ governmentName: GOVERNMENT, showLanguageToggle: false, links: before });
    expect((await list()).length).toBeGreaterThan(1);

    await putSettings({ governmentName: GOVERNMENT, showLanguageToggle: true }).expect(200);
    expect(await publicFeed()).toEqual({ governmentName: GOVERNMENT, showLanguageToggle: true, links: before });
  });

  it('a blank government name (or null) switches the bold text off: the feed says null, the admin form gets blanks', async () => {
    const before = await publicLinks();
    const blank = await putSettings({ governmentName: BLANK, showLanguageToggle: true });
    expect(blank.status).toBe(200);
    expect(blank.body.data).toMatchObject({ governmentName: BLANK, showLanguageToggle: true });
    expect(await publicFeed()).toEqual({ governmentName: null, showLanguageToggle: true, links: before });

    await putSettings({ governmentName: GOVERNMENT, showLanguageToggle: true }).expect(200);
    const cleared = await putSettings({ governmentName: null, showLanguageToggle: true });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.governmentName).toEqual(BLANK);
    expect((await publicFeed())!.governmentName).toBeNull();

    /* Blank in both languages, even with stray spaces, is the same as none. */
    await putSettings({ governmentName: GOVERNMENT, showLanguageToggle: true }).expect(200);
    await putSettings({ governmentName: pair('   ', '  '), showLanguageToggle: true }).expect(200);
    expect((await publicFeed())!.governmentName).toBeNull();

    await putSettings({ governmentName: GOVERNMENT, showLanguageToggle: true }).expect(200);
    expect((await publicFeed())!.governmentName).toEqual(GOVERNMENT);
  });

  it('the language switch and the name are independent of the links: hiding every link leaves them as they are', async () => {
    const rows = await list();
    for (const r of rows)
      await request(app).patch(`${ADMIN_URL}/${r.id}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);
    expect(await publicFeed()).toEqual({ governmentName: GOVERNMENT, showLanguageToggle: true, links: [] });
    for (const r of rows)
      await request(app).patch(`${ADMIN_URL}/${r.id}/status`).set(auth(admin.token)).send({ isActive: r.isActive }).expect(200);
    expect((await publicLinks()).length).toBe(rows.filter((r) => r.isActive).length);
  });

  it('refuses a half-filled or over-long name, a missing or non-boolean switch, and stale saves', async () => {
    const half = await putSettings({ governmentName: pair('फक्त मराठी', ''), showLanguageToggle: true });
    expect(half.status).toBe(422);
    expect(details(half)).toEqual([
      { field: 'body.governmentName.en', message: 'Government name (English) is required when the Marathi text is filled in' },
    ]);
    const englishOnly = await putSettings({ governmentName: pair('', 'Only English'), showLanguageToggle: true });
    expect(details(englishOnly)).toEqual([
      { field: 'body.governmentName.mr', message: 'Government name (Marathi) is required when the English text is filled in' },
    ]);

    const long = await putSettings({ governmentName: pair('म'.repeat(81), 'e'.repeat(81)), showLanguageToggle: 'yes' });
    expect(long.status).toBe(422);
    expect(details(long)).toEqual(
      expect.arrayContaining([
        { field: 'body.governmentName.mr', message: 'Government name (Marathi) must be at most 80 characters' },
        { field: 'body.governmentName.en', message: 'Government name (English) must be at most 80 characters' },
        { field: 'body.showLanguageToggle', message: 'showLanguageToggle must be true or false' },
      ]),
    );

    const notAPair = await putSettings({ governmentName: 'text', showLanguageToggle: true });
    expect(details(notAPair)).toEqual([{ field: 'body.governmentName', message: 'Government name must have Marathi and English text' }]);

    /* A missing name is refused, never read as "blank": a stale client cannot wipe the name by leaving it out. */
    const missing = await putSettings({});
    expect(missing.status).toBe(422);
    expect(
      details(missing)
        .map((d) => d.field)
        .sort(),
    ).toEqual(['body.governmentName', 'body.showLanguageToggle']);
    expect(details(missing)).toContainEqual({ field: 'body.governmentName', message: 'Government name is required' });
    expect(details(missing)).toContainEqual({ field: 'body.showLanguageToggle', message: 'showLanguageToggle is required' });

    const unknownKey = await putSettings({ governmentName: GOVERNMENT, showLanguageToggle: true, label: GOVERNMENT });
    expect(unknownKey.status).toBe(422);

    expect(
      (await putSettings({ governmentName: GOVERNMENT, showLanguageToggle: true, expectedUpdatedAt: '2020-01-01T00:00:00.000Z' })).status,
    ).toBe(409);
    expect(await getSettings()).toMatchObject({ governmentName: GOVERNMENT, showLanguageToggle: true });
  });

  it('keeps the saved settings when the database save fails', async () => {
    const before = await getSettings();
    jest.spyOn(auditService, 'recordInTx').mockRejectedValueOnce(new Error('simulated database failure'));
    const res = await putSettings({ governmentName: BLANK, showLanguageToggle: false });
    expect(res.status).toBe(500);
    expect(await getSettings()).toEqual(before);
  });
});

describe('Access control', () => {
  it('the public feed needs no session', async () => {
    const res = await request(app).get(PUBLIC_URL);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(await publicFeed());
  });

  it('refuses every admin route without a session', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect((await request(app).get(ADMIN_URL)).status).toBe(401);
    expect((await request(app).post(ADMIN_URL).send(linkBody(30))).status).toBe(401);
    expect((await request(app).get(`${ADMIN_URL}/settings`)).status).toBe(401);
    expect((await request(app).put(`${ADMIN_URL}/settings`).send({})).status).toBe(401);
    expect(
      (
        await request(app)
          .put(`${ADMIN_URL}/order`)
          .send({ ids: [id] })
      ).status,
    ).toBe(401);
    expect((await request(app).patch(`${ADMIN_URL}/${id}`).send({})).status).toBe(401);
    expect((await request(app).patch(`${ADMIN_URL}/${id}/status`).send({ isActive: false })).status).toBe(401);
    expect((await request(app).delete(`${ADMIN_URL}/${id}`)).status).toBe(401);
  });

  it('a view-only administrator can read but not create, edit, reorder, change settings or delete', async () => {
    const viewer = await actorWith(['cms-topbar.view']);
    const [first] = await list();
    const V = auth(viewer.token);
    expect((await request(app).get(ADMIN_URL).set(V)).status).toBe(200);
    expect((await request(app).get(`${ADMIN_URL}/settings`).set(V)).status).toBe(200);
    expect((await request(app).get(`${ADMIN_URL}/${first!.id}`).set(V)).status).toBe(200);
    expect((await create(linkBody(31), viewer.token)).status).toBe(403);
    expect((await request(app).patch(`${ADMIN_URL}/${first!.id}`).set(V).send({ link: '/apply' })).status).toBe(403);
    expect((await request(app).patch(`${ADMIN_URL}/${first!.id}/status`).set(V).send({ isActive: false })).status).toBe(403);
    expect(
      (
        await request(app)
          .put(`${ADMIN_URL}/order`)
          .set(V)
          .send({ ids: [first!.id] })
      ).status,
    ).toBe(403);
    expect((await request(app).put(`${ADMIN_URL}/settings`).set(V).send({})).status).toBe(403);
    expect((await request(app).delete(`${ADMIN_URL}/${first!.id}`).set(V)).status).toBe(403);
    expect(await get(first!.id)).toEqual(first);
  });

  it('another CMS permission does not open this section', async () => {
    const other = await actorWith(['cms-schemes.view', 'cms-schemes.update']);
    expect((await request(app).get(ADMIN_URL).set(auth(other.token))).status).toBe(403);
    /* Nor does the neighbouring Announcements tab. */
    const announcements = await actorWith(['cms-announcements.view', 'cms-announcements.update']);
    expect((await request(app).get(ADMIN_URL).set(auth(announcements.token))).status).toBe(403);
    expect((await request(app).get(`${ADMIN_URL}/settings`).set(auth(announcements.token))).status).toBe(403);
  });

  it('a Website Admin manages it end to end: add, edit, hide, reorder, settings and delete', async () => {
    const user = await createUser({ roleCodes: [ROLE_CODES.WEBSITE_ADMIN] });
    const W = auth(await login(user.email));
    const created = await request(app)
      .post(ADMIN_URL)
      .set(W)
      .send({ label: pair('वेबसाइट दुवा', 'Website link'), link: '/apply' });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect((await request(app).get(ADMIN_URL).set(W)).status).toBe(200);
    expect((await request(app).get(`${ADMIN_URL}/${id}`).set(W)).status).toBe(200);
    const edited = await request(app).patch(`${ADMIN_URL}/${id}`).set(W).send({ link: 'www.example.gov.in' });
    expect(edited.status).toBe(200);
    expect(edited.body.data.link).toBe('https://www.example.gov.in');
    expect((await request(app).patch(`${ADMIN_URL}/${id}/status`).set(W).send({ isActive: false })).status).toBe(200);
    const ids = (await list()).map((r) => r.id);
    expect(
      (
        await request(app)
          .put(`${ADMIN_URL}/order`)
          .set(W)
          .send({ ids: [id, ...ids.filter((x) => x !== id)] })
      ).status,
    ).toBe(200);
    const settings = (await request(app).get(`${ADMIN_URL}/settings`).set(W)).body.data;
    expect(
      (await request(app).put(`${ADMIN_URL}/settings`).set(W).send({ governmentName: settings.governmentName, showLanguageToggle: true }))
        .status,
    ).toBe(200);
    expect((await request(app).delete(`${ADMIN_URL}/${id}`).set(W)).status).toBe(200);
  });
});
