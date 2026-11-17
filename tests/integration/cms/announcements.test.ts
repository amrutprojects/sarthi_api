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
import { seedAnnouncements } from '../../../src/database/seeds/seed-announcements';
import { auditService } from '../../../src/modules/audit/audit.service';
import { ROLE_CODES } from '../../../src/modules/roles-permissions';

const ADMIN_URL = `${API}/cms/announcements`;
const PUBLIC_URL = `${API}/public/announcements`;

let app: Express;
let admin: TestActor;

interface Pair {
  mr: string;
  en: string;
}
interface AdminAnnouncement {
  id: string;
  title: Pair;
  detail: Pair | null;
  link: string | null;
  displayOrder: number;
  isActive: boolean;
  updatedAt: string;
}
interface PublicItem {
  title: Pair;
  detail?: Pair;
  link?: string;
}
interface Detail {
  field: string;
  message: string;
}

const pair = (mr: string, en: string): Pair => ({ mr, en });
const BLANK = pair('', '');
const LABEL = pair('सूचना', 'Announcements');
/* One announcement the rest of the suite builds on (the seed itself creates none). */
const EXISTING = pair('विद्यमान सूचना', 'Existing announcement');

const announcement = (n: number, extra: Record<string, unknown> = {}) => ({
  title: pair(`चाचणी सूचना ${n}`, `Test announcement ${n}`),
  ...extra,
});

const details = (res: { body: { error: { details: Detail[] } } }) => res.body.error.details;
const list = async (): Promise<AdminAnnouncement[]> => (await request(app).get(ADMIN_URL).set(auth(admin.token)).expect(200)).body.data;
const publicFeed = async () =>
  (await request(app).get(PUBLIC_URL).expect(200)).body.data as { showSection: boolean; label: Pair; items: PublicItem[] } | null;
const publicItems = async () => (await publicFeed())!.items;
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
const get = async (id: string): Promise<AdminAnnouncement> =>
  (await request(app).get(`${ADMIN_URL}/${id}`).set(auth(admin.token)).expect(200)).body.data;
const countRows = async () =>
  (await AppDataSource.query(`SELECT count(*)::int AS n FROM "announcements" WHERE "isDelete" = false`))[0].n as number;

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
});
afterAll(teardownTestApp);
afterEach(() => jest.restoreAllMocks());

describe('Announcements — before the seed', () => {
  it('the public feed is null while the ticker is not configured, so the website keeps its bundled notice', async () => {
    expect(await publicFeed()).toBeNull();
    expect((await request(app).get(`${ADMIN_URL}/settings`).set(auth(admin.token))).status).toBe(404);
    expect((await putSettings({ label: LABEL, showSection: true })).status).toBe(404);
    expect(await list()).toEqual([]);
  });
});

describe('Announcements seed', () => {
  it('seeds the label and no announcement, so the website shows no strip', async () => {
    expect(await seedAnnouncements(AppDataSource)).toEqual({ created: true, announcementsCreated: 0 });
    expect(await list()).toEqual([]);

    const settings = (await request(app).get(`${ADMIN_URL}/settings`).set(auth(admin.token)).expect(200)).body.data;
    expect(settings).toMatchObject({ label: LABEL, showSection: true });

    expect(await publicFeed()).toEqual({ showSection: true, label: LABEL, items: [] });
  });

  it('is idempotent and never brings back a deleted announcement', async () => {
    const added = await create({ title: EXISTING }).expect(201);
    await request(app).delete(`${ADMIN_URL}/${added.body.data.id}`).set(auth(admin.token)).expect(200);
    expect(await seedAnnouncements(AppDataSource)).toEqual({ created: false, announcementsCreated: 0 });
    expect(await list()).toEqual([]);
    expect(await publicFeed()).toEqual({ showSection: true, label: LABEL, items: [] });
    /* One announcement for the rest of the suite. */
    await create({ title: EXISTING }).expect(201);
  });
});

describe('Adding an announcement', () => {
  it('adds at the end, trims the text, keeps Marathi intact and keeps every text on one line', async () => {
    const res = await create({
      title: pair('  प्रवेश   सुरू ', 'Admissions open'),
      detail: pair('अर्ज ३१ मार्चपर्यंत —\nज्ञ, क्ष', 'Apply by\n31 March'),
      link: '/apply',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      title: pair('प्रवेश सुरू', 'Admissions open'),
      detail: pair('अर्ज ३१ मार्चपर्यंत — ज्ञ, क्ष', 'Apply by 31 March'),
      link: '/apply',
      isActive: true,
      displayOrder: 2,
    });
    const items = await publicItems();
    expect(items).toHaveLength(2);
    expect(items[1]).toEqual({
      title: pair('प्रवेश सुरू', 'Admissions open'),
      detail: pair('अर्ज ३१ मार्चपर्यंत — ज्ञ, क्ष', 'Apply by 31 March'),
      link: '/apply',
    });
  });

  it('takes an external address, and a detail that is null or blank in both languages means none', async () => {
    const external = (await create(announcement(1, { link: 'https://example.gov.in/notice?id=7' })).expect(201)).body.data;
    expect(external).toMatchObject({ link: 'https://example.gov.in/notice?id=7', detail: null });
    expect((await create(announcement(2, { detail: null, link: null })).expect(201)).body.data).toMatchObject({ detail: null, link: null });
    expect((await create(announcement(3, { detail: BLANK, link: '  ' })).expect(201)).body.data).toMatchObject({
      detail: null,
      link: null,
    });
    const items = await publicItems();
    expect(items.find((i) => i.title.en === 'Test announcement 1')).toEqual({
      title: pair('चाचणी सूचना 1', 'Test announcement 1'),
      link: 'https://example.gov.in/notice?id=7',
    });
    expect(items.find((i) => i.title.en === 'Test announcement 3')).toEqual({ title: pair('चाचणी सूचना 3', 'Test announcement 3') });
  });

  it('takes an address typed as www. and stores it with https://', async () => {
    const res = await create(announcement(4, { link: ' www.example.gov.in/notice ' })).expect(201);
    expect(res.body.data).toMatchObject({ link: 'https://www.example.gov.in/notice' });
    expect((await patch(res.body.data.id, { link: 'WWW.mahadbt.gov.in' })).body.data).toMatchObject({ link: 'https://WWW.mahadbt.gov.in' });
  });

  it('adds a hidden announcement that the website does not show', async () => {
    const hidden = (await create(announcement(4, { isActive: false, displayOrder: 50 })).expect(201)).body.data as AdminAnnouncement;
    expect(hidden).toMatchObject({ isActive: false, displayOrder: 50 });
    expect((await publicItems()).map((i) => i.title.en)).not.toContain('Test announcement 4');
    expect((await list()).map((r) => r.id)).toContain(hidden.id);
  });

  it('replays a double-submitted form (same Idempotency-Key) instead of adding the announcement twice', async () => {
    const KEY = 'announcements-test-key-0005';
    const before = await countRows();
    const send = () => create(announcement(5)).set('Idempotency-Key', KEY);
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
  it('names each missing field', async () => {
    const res = await create({ detail: pair('', 'x') });
    expect(res.status).toBe(422);
    expect(
      details(res)
        .map((d) => d.field)
        .sort(),
    ).toEqual(['body.detail.mr', 'body.title']);
    expect(details(res)).toContainEqual({ field: 'body.title', message: 'Title is required' });
  });

  it('refuses blank halves, over-long text and a half-filled detail', async () => {
    const res = await create({ title: pair('   ', 'x'.repeat(201)), detail: pair('फक्त मराठी', '') });
    expect(res.status).toBe(422);
    expect(details(res)).toEqual(
      expect.arrayContaining([
        { field: 'body.title.mr', message: 'Title (Marathi) is required' },
        { field: 'body.title.en', message: 'Title (English) must be at most 200 characters' },
        { field: 'body.detail.en', message: 'Detail (English) is required when the Marathi text is filled in' },
      ]),
    );
    const long = await create(announcement(6, { detail: pair('d', 'y'.repeat(501)) }));
    expect(long.status).toBe(422);
    expect(details(long)).toEqual([{ field: 'body.detail.en', message: 'Detail (English) must be at most 500 characters' }]);
    const englishOnly = await create(announcement(6, { detail: pair('', 'Only English') }));
    expect(details(englishOnly)).toEqual([
      { field: 'body.detail.mr', message: 'Detail (Marathi) is required when the English text is filled in' },
    ]);
  });

  it('accepts a title of exactly 200 characters', async () => {
    const res = await create({ title: pair('म'.repeat(200), 'e'.repeat(200)) });
    expect(res.status).toBe(201);
    await request(app).delete(`${ADMIN_URL}/${res.body.data.id}`).set(auth(admin.token)).expect(200);
  });

  it.each([
    ['javascript:alert(1)', 'Destination must be a page on this site starting with /, or a web address starting with https:// or www.'],
    ['data:text/html,hi', 'Destination must be a page on this site starting with /, or a web address starting with https:// or www.'],
    ['//evil.example.com', 'A page on this site must start with a single / and use only letters, digits and - _ . ~ / ? = & % #'],
    ['/apply"><script>', 'A page on this site must start with a single / and use only letters, digits and - _ . ~ / ? = & % #'],
    ['apply', 'Destination must be a page on this site starting with /, or a web address starting with https:// or www.'],
    ['https://user:pw@example.gov.in', 'The address must not contain a user name or password'],
    ['https://localhost/x', 'Enter a full address, e.g. https://example.gov.in'],
    [`/${'a'.repeat(500)}`, 'Destination must be at most 500 characters'],
  ])('refuses the link %j', async (link, message) => {
    const res = await create(announcement(7, { link }));
    expect(res.status).toBe(422);
    expect(details(res)).toEqual([{ field: 'body.link', message }]);
  });

  it('refuses unknown fields, a non-boolean status, a detail that is not a pair and a link that is not text', async () => {
    const res = await create(announcement(7, { isActive: 'yes', detail: 'text', link: 42, html: '<b>x</b>' }));
    expect(res.status).toBe(422);
    expect(
      details(res)
        .map((d) => d.field)
        .sort(),
    ).toEqual(['body', 'body.detail', 'body.isActive', 'body.link']);
    expect(details(res)).toEqual(
      expect.arrayContaining([
        { field: 'body.link', message: 'Destination must be text or null' },
        { field: 'body.detail', message: 'Detail must have Marathi and English text' },
        { field: 'body.isActive', message: 'Status must be true or false' },
      ]),
    );
  });

  it('answers 422 for a malformed id and 404 for an unknown one', async () => {
    expect((await request(app).get(`${ADMIN_URL}/nope`).set(auth(admin.token))).status).toBe(422);
    const unknown = '00000000-0000-4000-8000-000000000000';
    expect((await request(app).get(`${ADMIN_URL}/${unknown}`).set(auth(admin.token))).status).toBe(404);
    expect((await patch(unknown, { link: null })).status).toBe(404);
    expect((await request(app).patch(`${ADMIN_URL}/${unknown}/status`).set(auth(admin.token)).send({ isActive: false })).status).toBe(404);
    expect((await request(app).delete(`${ADMIN_URL}/${unknown}`).set(auth(admin.token))).status).toBe(404);
  });

  it('the database itself refuses an unsafe link and a half-filled detail', async () => {
    const insert = (detailMr: string, detailEn: string, link: string | null) =>
      AppDataSource.query(
        `INSERT INTO "announcements" ("titleMr", "titleEn", "detailMr", "detailEn", "link", "displayOrder") VALUES ('अ', 'A', $1, $2, $3, 1)`,
        [detailMr, detailEn, link],
      );
    await expect(insert('', '', 'javascript:alert(1)')).rejects.toThrow(/CHK_announcements_link/);
    await expect(insert('', '', '//evil.example.com')).rejects.toThrow(/CHK_announcements_link/);
    await expect(insert('फक्त', '', null)).rejects.toThrow(/CHK_announcements_detail_pair/);
  });
});

describe('Editing an announcement', () => {
  let a: AdminAnnouncement;
  beforeAll(async () => {
    a = (await create(announcement(10, { detail: pair('तपशील', 'Detail'), link: '/faq' })).expect(201)).body.data;
  });

  it('changes only the fields sent', async () => {
    const res = await patch(a.id, { link: '/eligibility' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      title: a.title,
      detail: pair('तपशील', 'Detail'),
      link: '/eligibility',
      displayOrder: a.displayOrder,
    });
    a = res.body.data;
  });

  it('updates title, detail and link together, and can clear the optional ones', async () => {
    const res = await patch(a.id, {
      title: pair('सुधारित सूचना', 'Updated announcement'),
      detail: pair('नवीन तपशील', 'New detail'),
      link: 'https://example.gov.in/updated',
      expectedUpdatedAt: a.updatedAt,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      title: pair('सुधारित सूचना', 'Updated announcement'),
      detail: pair('नवीन तपशील', 'New detail'),
      link: 'https://example.gov.in/updated',
    });
    const cleared = (await patch(a.id, { detail: null, link: null })).body.data as AdminAnnouncement;
    expect(cleared).toMatchObject({ detail: null, link: null, title: pair('सुधारित सूचना', 'Updated announcement') });
    expect((await publicItems()).find((i) => i.title.en === 'Updated announcement')).toEqual({
      title: pair('सुधारित सूचना', 'Updated announcement'),
    });
    expect((await patch(a.id, { detail: pair('पुन्हा', 'Again') })).body.data.detail).toEqual(pair('पुन्हा', 'Again'));
    expect((await patch(a.id, { detail: BLANK })).body.data.detail).toBeNull();
    a = await get(a.id);
  });

  it('refuses a save over a newer version, and changes nothing', async () => {
    const res = await patch(a.id, { link: '/apply', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' });
    expect(res.status).toBe(409);
    expect(await get(a.id)).toEqual(a);
  });

  it('keeps the saved announcement when the database save fails', async () => {
    jest.spyOn(auditService, 'recordInTx').mockRejectedValueOnce(new Error('simulated database failure'));
    const res = await patch(a.id, { title: pair('टिकू नये', 'Must not stick'), link: '/apply' });
    expect(res.status).toBe(500);
    expect(await get(a.id)).toEqual(a);
  });

  it('keeps the saved announcement when an invalid edit is refused', async () => {
    expect((await patch(a.id, { title: pair('', ''), link: 'javascript:alert(1)' })).status).toBe(422);
    expect(await get(a.id)).toEqual(a);
  });

  it('a hidden announcement leaves the website and comes back when shown', async () => {
    const hidden = await request(app).patch(`${ADMIN_URL}/${a.id}/status`).set(auth(admin.token)).send({ isActive: false });
    expect(hidden.status).toBe(200);
    expect(hidden.body.message).toBe('Announcement hidden from the website');
    expect(hidden.body.data.isActive).toBe(false);
    expect((await publicItems()).map((i) => i.title.en)).not.toContain('Updated announcement');
    await request(app).patch(`${ADMIN_URL}/${a.id}/status`).set(auth(admin.token)).send({ isActive: true }).expect(200);
    expect((await publicItems()).map((i) => i.title.en)).toContain('Updated announcement');
  });
});

describe('Deleting and ordering', () => {
  it('deletes only the chosen announcement: soft-deleted, gone from the website, the rest untouched', async () => {
    const a = (await create(announcement(20)).expect(201)).body.data as AdminAnnouncement;
    const others = (await list()).filter((x) => x.id !== a.id);
    const res = await request(app).delete(`${ADMIN_URL}/${a.id}`).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Announcement deleted successfully');
    expect(await list()).toEqual(others);
    expect((await publicItems()).map((i) => i.title.en)).not.toContain('Test announcement 20');
    const [row] = await AppDataSource.query(`SELECT "isDelete", "isActive" FROM "announcements" WHERE "id" = $1`, [a.id]);
    expect(row).toEqual({ isDelete: true, isActive: false });
    expect((await request(app).delete(`${ADMIN_URL}/${a.id}`).set(auth(admin.token))).status).toBe(404);
    expect((await request(app).get(`${ADMIN_URL}/${a.id}`).set(auth(admin.token))).status).toBe(404);
  });

  it('reorders by id — the website follows, active ones only — and refuses a stale or duplicated list', async () => {
    const rows = await list();
    const reversed = rows.map((r) => r.id).reverse();
    const res = await request(app).put(`${ADMIN_URL}/order`).set(auth(admin.token)).send({ ids: reversed });
    expect(res.status).toBe(200);
    expect((res.body.data as AdminAnnouncement[]).map((r) => [r.id, r.displayOrder])).toEqual(reversed.map((id, i) => [id, i + 1]));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect((await publicItems()).map((i) => i.title.en)).toEqual(
      reversed
        .map((id) => byId.get(id)!)
        .filter((r) => r.isActive)
        .map((r) => r.title.en),
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

describe('Ticker settings', () => {
  it('updates the label and can switch the ticker off and on, keeping the announcements', async () => {
    const current = (await request(app).get(`${ADMIN_URL}/settings`).set(auth(admin.token)).expect(200)).body.data;
    const res = await putSettings({ label: pair('  नवीन  ', 'Latest'), showSection: true, expectedUpdatedAt: current.updatedAt });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ label: pair('नवीन', 'Latest'), showSection: true });
    const before = await publicItems();
    expect((await publicFeed())!.label).toEqual(pair('नवीन', 'Latest'));

    await putSettings({ label: pair('नवीन', 'Latest'), showSection: false }).expect(200);
    /* Switched off: the feed is still there (not null) and says so, so the website shows no strip rather than its bundled notice. */
    expect(await publicFeed()).toEqual({ showSection: false, label: pair('नवीन', 'Latest'), items: [] });
    expect((await list()).length).toBeGreaterThan(1);

    await putSettings({ label: LABEL, showSection: true }).expect(200);
    expect(await publicItems()).toEqual(before);
  });

  it('requires a label in both languages of at most 60 characters and a visibility flag, and refuses stale saves', async () => {
    const res = await putSettings({ label: pair('', 'x'.repeat(61)), showSection: 'yes' });
    expect(res.status).toBe(422);
    expect(details(res)).toEqual(
      expect.arrayContaining([
        { field: 'body.label.mr', message: 'Label (Marathi) is required' },
        { field: 'body.label.en', message: 'Label (English) must be at most 60 characters' },
        { field: 'body.showSection', message: 'showSection must be true or false' },
      ]),
    );
    const missing = await putSettings({});
    expect(
      details(missing)
        .map((d) => d.field)
        .sort(),
    ).toEqual(['body.label', 'body.showSection']);
    expect((await putSettings({ label: LABEL, showSection: true, expectedUpdatedAt: '2020-01-01T00:00:00.000Z' })).status).toBe(409);
    expect((await request(app).get(`${ADMIN_URL}/settings`).set(auth(admin.token))).body.data.label).toEqual(LABEL);
  });
});

describe('Access control', () => {
  it('refuses every admin route without a session', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect((await request(app).get(ADMIN_URL)).status).toBe(401);
    expect((await request(app).post(ADMIN_URL).send(announcement(30))).status).toBe(401);
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
    expect((await request(app).delete(`${ADMIN_URL}/${id}`)).status).toBe(401);
  });

  it('a view-only administrator can read but not create, edit, reorder, change settings or delete', async () => {
    const viewer = await actorWith(['cms-announcements.view']);
    const [first] = await list();
    const V = auth(viewer.token);
    expect((await request(app).get(ADMIN_URL).set(V)).status).toBe(200);
    expect((await request(app).get(`${ADMIN_URL}/settings`).set(V)).status).toBe(200);
    expect((await request(app).get(`${ADMIN_URL}/${first!.id}`).set(V)).status).toBe(200);
    expect((await create(announcement(31), viewer.token)).status).toBe(403);
    expect((await request(app).patch(`${ADMIN_URL}/${first!.id}`).set(V).send({ link: null })).status).toBe(403);
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
  });

  it('a Website Admin manages it end to end: add, edit, hide, reorder, settings and delete', async () => {
    const user = await createUser({ roleCodes: [ROLE_CODES.WEBSITE_ADMIN] });
    const W = auth(await login(user.email));
    const created = await request(app)
      .post(ADMIN_URL)
      .set(W)
      .send({ title: pair('वेबसाइट सूचना', 'Website notice'), link: '/apply' });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect((await request(app).get(ADMIN_URL).set(W)).status).toBe(200);
    expect((await request(app).get(`${ADMIN_URL}/${id}`).set(W)).status).toBe(200);
    const edited = await request(app)
      .patch(`${ADMIN_URL}/${id}`)
      .set(W)
      .send({ detail: pair('तपशील', 'Details') });
    expect(edited.status).toBe(200);
    expect(edited.body.data.detail).toEqual(pair('तपशील', 'Details'));
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
    expect((await request(app).put(`${ADMIN_URL}/settings`).set(W).send({ label: settings.label, showSection: true })).status).toBe(200);
    expect((await request(app).delete(`${ADMIN_URL}/${id}`).set(W)).status).toBe(200);
  });
});
