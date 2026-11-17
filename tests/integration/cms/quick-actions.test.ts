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
import { QUICK_ACTION_ICONS } from '../../../src/cms/quickactions/quickactions.icons';
import { auditService } from '../../../src/modules/audit/audit.service';
import { ROLE_CODES } from '../../../src/modules/roles-permissions';

const ADMIN_URL = `${API}/cms/quick-actions`;
const PUBLIC_URL = `${API}/public/quick-actions`;
const SWITCH_URL = `${API}/cms/section-visibility/quick-actions`;

let app: Express;
let admin: TestActor;

interface Pair {
  mr: string;
  en: string;
}
interface AdminAction {
  id: string;
  title: Pair;
  subtitle: Pair;
  icon: string;
  link: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
interface PublicAction {
  title: Pair;
  subtitle: Pair | null;
  icon: string;
  link: string;
}
interface PublicFeed {
  showSection: boolean;
  actions: PublicAction[];
}
interface Detail {
  field: string;
  message: string;
}

const pair = (mr: string, en: string): Pair => ({ mr, en });
const BLANK = pair('', '');

/* What the home page strip carried before it was managed, word for word, in order — the rows the migration inserts. */
const DEFAULTS: PublicAction[] = [
  {
    icon: 'plus',
    title: pair('आता अर्ज करा', 'Apply Now'),
    subtitle: pair('नवीन नोंदणी करा', 'Register as a new candidate'),
    link: '/apply',
  },
  {
    icon: 'search',
    title: pair('अर्जाची स्थिती पहा', 'Check Application Status'),
    subtitle: pair('अर्ज क्रमांकाने तपासा', 'Track by application ID'),
    link: '/track',
  },
  {
    icon: 'qr',
    title: pair('प्रमाणपत्र पडताळणी', 'Verify Certificate'),
    subtitle: pair('QR किंवा क्रमांकाने', 'By QR or certificate number'),
    link: '/verify',
  },
  {
    icon: 'building',
    title: pair('प्रशिक्षण केंद्रे', 'Training centres'),
    subtitle: pair('जवळचे केंद्र शोधा', 'Find a centre near you'),
    link: '/contact',
  },
];

const DESTINATION_HELP = 'Destination must be a page on this site starting with /, or a web address starting with https:// or www.';
const PAGE_HELP = 'A page on this site must start with a single / and use only letters, digits and - _ . ~ / ? = & % #';
const ICON_HELP = 'Choose one of the listed icons';

const actionBody = (n: number, extra: Record<string, unknown> = {}) => ({
  title: pair(`चाचणी ${n}`, `Test action ${n}`),
  subtitle: pair(`चाचणी उपशीर्षक ${n}`, `Test subtitle ${n}`),
  icon: 'doc',
  link: `/test-${n}`,
  ...extra,
});

const details = (res: { body: { error: { details: Detail[] } } }) => res.body.error.details;
const list = async (): Promise<AdminAction[]> => (await request(app).get(ADMIN_URL).set(auth(admin.token)).expect(200)).body.data;
const publicFeed = async () => (await request(app).get(PUBLIC_URL).expect(200)).body.data as PublicFeed | null;
const publicActions = async () => (await publicFeed())!.actions;
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
const get = async (id: string): Promise<AdminAction> =>
  (await request(app).get(`${ADMIN_URL}/${id}`).set(auth(admin.token)).expect(200)).body.data;
const remove = (id: string) => request(app).delete(`${ADMIN_URL}/${id}`).set(auth(admin.token));
const countRows = async () =>
  (await AppDataSource.query(`SELECT count(*)::int AS n FROM "quick_actions" WHERE "isDelete" = false`))[0].n as number;
const lastAudit = async (action: string) =>
  (
    await AppDataSource.query(
      `SELECT "resource", "resourceId", "details", "actorUserId" FROM "audit_logs" WHERE "action" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
      [action],
    )
  )[0] as { resource: string; resourceId: string | null; details: Record<string, unknown>; actorUserId: string } | undefined;

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
});
/*
 * quick_action_settings and quick_actions survive resetData() (their rows come from the migration), so
 * the strip is left exactly as the migration made it: shown, with the four default tiles.
 */
afterAll(async () => {
  await AppDataSource.query(`UPDATE "quick_action_settings" SET "isDelete" = false, "isActive" = true, "showSection" = true`);
  await AppDataSource.query(`UPDATE "quick_actions" SET "isDelete" = true, "isActive" = false WHERE "isDelete" = false`);
  for (const [i, d] of DEFAULTS.entries()) {
    await AppDataSource.query(
      `INSERT INTO "quick_actions" ("titleMr", "titleEn", "subtitleMr", "subtitleEn", "icon", "link", "displayOrder")
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [d.title.mr, d.title.en, d.subtitle!.mr, d.subtitle!.en, d.icon, d.link, i + 1],
    );
  }
  await teardownTestApp();
});
afterEach(() => jest.restoreAllMocks());

describe('The strip the migration creates', () => {
  it('holds exactly the four tiles the home page showed, in order, all shown — and the strip is shown', async () => {
    const rows = await list();
    expect(
      rows.map(({ title, subtitle, icon, link, displayOrder, isActive }) => ({ title, subtitle, icon, link, displayOrder, isActive })),
    ).toEqual(DEFAULTS.map((d, i) => ({ ...d, displayOrder: i + 1, isActive: true })));
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual([
        'createdAt',
        'displayOrder',
        'icon',
        'id',
        'isActive',
        'link',
        'subtitle',
        'title',
        'updatedAt',
      ]);
      expect(new Date(r.updatedAt).toISOString()).toBe(r.updatedAt);
    }

    const res = await request(app).get(PUBLIC_URL);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Quick actions retrieved successfully');
    expect(res.body.data).toEqual({ showSection: true, actions: DEFAULTS });
    const [settings] = await AppDataSource.query(`SELECT "showSection", "isActive" FROM "quick_action_settings" WHERE "isDelete" = false`);
    expect(settings).toEqual({ showSection: true, isActive: true });
  });

  it('the icon list is exactly the 31 names the website and the admin panel share, in order', () => {
    expect([...QUICK_ACTION_ICONS]).toEqual([
      'plus',
      'search',
      'qr',
      'building',
      'doc',
      'check',
      'clipboard',
      'award',
      'users',
      'teacher',
      'phone',
      'mail',
      'help',
      'download',
      'calendar',
      'pin',
      'map',
      'home',
      'globe',
      'megaphone',
      'bell',
      'eye',
      'rupee',
      'layers',
      'monitor',
      'chart',
      'shield',
      'folder',
      'settings',
      'play',
      'clock',
    ]);
  });
});

describe('The public feed', () => {
  it('is null while the strip is not configured (no live settings row), so the website keeps its bundled tiles', async () => {
    await AppDataSource.query(`UPDATE "quick_action_settings" SET "isDelete" = true`);
    try {
      const res = await request(app).get(PUBLIC_URL);
      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
      expect(res.body.message).toBe('Quick actions are not configured');
      /* The tiles are still edited in the admin panel. */
      expect(await list()).toHaveLength(DEFAULTS.length);
    } finally {
      await AppDataSource.query(`UPDATE "quick_action_settings" SET "isDelete" = false`);
    }
    expect(await publicFeed()).toEqual({ showSection: true, actions: DEFAULTS });
  });

  it('is null while the settings row is inactive', async () => {
    await AppDataSource.query(`UPDATE "quick_action_settings" SET "isActive" = false WHERE "isDelete" = false`);
    try {
      expect(await publicFeed()).toBeNull();
    } finally {
      await AppDataSource.query(`UPDATE "quick_action_settings" SET "isActive" = true WHERE "isDelete" = false`);
    }
    expect(await publicFeed()).toEqual({ showSection: true, actions: DEFAULTS });
  });

  it('the "Show on website" switch hides the whole strip: showSection false and no tiles, never null', async () => {
    const off = await request(app).put(SWITCH_URL).set(auth(admin.token)).send({ visible: false });
    expect(off.status).toBe(200);
    expect(off.body.data).toMatchObject({ key: 'quick-actions', menu: 'cms-quickactions', visible: false, configured: true });
    expect(await publicFeed()).toEqual({ showSection: false, actions: [] });
    /* The admin list is untouched. */
    expect(await list()).toHaveLength(DEFAULTS.length);

    await request(app).put(SWITCH_URL).set(auth(admin.token)).send({ visible: true }).expect(200);
    expect(await publicFeed()).toEqual({ showSection: true, actions: DEFAULTS });
  });

  it('carries only what the strip prints, and needs no session', async () => {
    const feed = (await publicFeed())!;
    expect(Object.keys(feed).sort()).toEqual(['actions', 'showSection']);
    for (const a of feed.actions) expect(Object.keys(a).sort()).toEqual(['icon', 'link', 'subtitle', 'title']);
  });
});

describe('Adding a quick action', () => {
  it('adds at the end, trims the text, keeps Marathi intact and keeps every text on one line', async () => {
    const res = await create({
      title: pair('  नवीन   अर्ज ', 'New\n  form'),
      subtitle: pair(' येथे   भरा ', 'Fill\tit in  here'),
      icon: 'doc',
      link: '/apply',
    });
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Quick action created successfully');
    expect(res.body.data).toMatchObject({
      title: pair('नवीन अर्ज', 'New form'),
      subtitle: pair('येथे भरा', 'Fill it in here'),
      icon: 'doc',
      link: '/apply',
      isActive: true,
      displayOrder: DEFAULTS.length + 1,
    });
    const actions = await publicActions();
    expect(actions).toHaveLength(DEFAULTS.length + 1);
    expect(actions[DEFAULTS.length]).toEqual({
      title: pair('नवीन अर्ज', 'New form'),
      subtitle: pair('येथे भरा', 'Fill it in here'),
      icon: 'doc',
      link: '/apply',
    });
  });

  it('a missing, null or blank subtitle is no subtitle: blanks in the admin panel, null on the website', async () => {
    const missing = (await create({ title: pair('शीर्षक 1', 'No subtitle 1'), icon: 'help', link: '/faq' }).expect(201)).body.data;
    const nulled = (await create(actionBody(2, { title: pair('शीर्षक 2', 'No subtitle 2'), subtitle: null })).expect(201)).body.data;
    const blank = (await create(actionBody(3, { title: pair('शीर्षक 3', 'No subtitle 3'), subtitle: pair('  ', '') })).expect(201)).body
      .data;
    for (const a of [missing, nulled, blank]) {
      expect(a.subtitle).toEqual(BLANK);
      expect((await get(a.id)).subtitle).toEqual(BLANK);
    }
    const [row] = await AppDataSource.query(`SELECT "subtitleMr", "subtitleEn" FROM "quick_actions" WHERE "id" = $1`, [blank.id]);
    expect(row).toEqual({ subtitleMr: '', subtitleEn: '' });
    const onSite = (await publicActions()).filter((a) => a.title.en.startsWith('No subtitle'));
    expect(onSite).toEqual([
      { title: pair('शीर्षक 1', 'No subtitle 1'), subtitle: null, icon: 'help', link: '/faq' },
      { title: pair('शीर्षक 2', 'No subtitle 2'), subtitle: null, icon: 'doc', link: '/test-2' },
      { title: pair('शीर्षक 3', 'No subtitle 3'), subtitle: null, icon: 'doc', link: '/test-3' },
    ]);
  });

  it('takes an external address and a page with a query string', async () => {
    const external = (await create(actionBody(4, { link: 'https://example.gov.in/notice?id=7' })).expect(201)).body.data;
    expect(external).toMatchObject({ link: 'https://example.gov.in/notice?id=7' });
    const page = (await create(actionBody(5, { link: '/apply?x=1#top' })).expect(201)).body.data;
    expect(page).toMatchObject({ link: '/apply?x=1#top' });
    expect((await publicActions()).find((a) => a.title.en === 'Test action 4')!.link).toBe('https://example.gov.in/notice?id=7');
  });

  it('takes an address typed as www. and stores it with https://', async () => {
    const res = await create(actionBody(6, { link: ' www.example.gov.in/centres ' })).expect(201);
    expect(res.body.data).toMatchObject({ link: 'https://www.example.gov.in/centres' });
    expect((await patch(res.body.data.id, { link: 'WWW.mahadbt.gov.in' })).body.data).toMatchObject({ link: 'https://WWW.mahadbt.gov.in' });
    /* The website receives the normalised address, ready to put in an href. */
    expect((await publicActions()).find((a) => a.title.en === 'Test action 6')!.link).toBe('https://WWW.mahadbt.gov.in');
  });

  it('adds a hidden tile that the website does not show, at the order given', async () => {
    const hidden = (await create(actionBody(7, { isActive: false, displayOrder: 50 })).expect(201)).body.data as AdminAction;
    expect(hidden).toMatchObject({ isActive: false, displayOrder: 50 });
    expect((await publicActions()).map((a) => a.title.en)).not.toContain('Test action 7');
    expect((await list()).map((r) => r.id)).toContain(hidden.id);
  });

  it('replays a double-submitted form (same Idempotency-Key) instead of adding the tile twice', async () => {
    const KEY = 'quick-actions-test-key-0008';
    const before = await countRows();
    const send = () => create(actionBody(8)).set('Idempotency-Key', KEY);
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

  it('records who added it, in the same transaction', async () => {
    const created = (await create(actionBody(9, { icon: 'bell' })).expect(201)).body.data as AdminAction;
    expect(await lastAudit('cms.quick-action.create')).toEqual({
      resource: 'quick-action',
      resourceId: created.id,
      actorUserId: admin.user.id,
      details: { title: 'Test action 9', icon: 'bell', link: '/test-9', isActive: true },
    });

    const before = await countRows();
    jest.spyOn(auditService, 'recordInTx').mockRejectedValueOnce(new Error('simulated database failure'));
    expect((await create(actionBody(10))).status).toBe(500);
    expect(await countRows()).toBe(before);
  });
});

describe('Validation', () => {
  it('names each missing field: a tile needs a title, an icon and a destination', async () => {
    const res = await create({});
    expect(res.status).toBe(422);
    expect(
      details(res)
        .map((d) => d.field)
        .sort(),
    ).toEqual(['body.icon', 'body.link', 'body.title']);
    expect(details(res)).toContainEqual({ field: 'body.title', message: 'Title is required' });
    expect(details(res)).toContainEqual({ field: 'body.icon', message: 'Icon is required' });
    expect(details(res)).toContainEqual({ field: 'body.link', message: 'Destination is required' });
  });

  it('refuses blank title halves and over-long titles', async () => {
    const res = await create(actionBody(20, { title: pair('   ', 'x'.repeat(41)) }));
    expect(res.status).toBe(422);
    expect(details(res)).toEqual(
      expect.arrayContaining([
        { field: 'body.title.mr', message: 'Title (Marathi) is required' },
        { field: 'body.title.en', message: 'Title (English) must be at most 40 characters' },
      ]),
    );
    const english = await create(actionBody(20, { title: pair('फक्त मराठी', '') }));
    expect(details(english)).toEqual([{ field: 'body.title.en', message: 'Title (English) is required' }]);
  });

  it('accepts a title of exactly 40 characters and a subtitle of exactly 60', async () => {
    const res = await create(
      actionBody(21, { title: pair('म'.repeat(40), 'e'.repeat(40)), subtitle: pair('म'.repeat(60), 'e'.repeat(60)) }),
    );
    expect(res.status).toBe(201);
    await remove(res.body.data.id).expect(200);
  });

  it('refuses a subtitle filled in one language only, or over 60 characters', async () => {
    const marathi = await create(actionBody(22, { subtitle: pair('फक्त मराठी', '') }));
    expect(marathi.status).toBe(422);
    expect(details(marathi)).toEqual([
      { field: 'body.subtitle.en', message: 'Subtitle (English) is required when the Marathi text is filled in' },
    ]);
    const english = await create(actionBody(22, { subtitle: pair('  ', 'Only English') }));
    expect(details(english)).toEqual([
      { field: 'body.subtitle.mr', message: 'Subtitle (Marathi) is required when the English text is filled in' },
    ]);
    const long = await create(actionBody(22, { subtitle: pair('म'.repeat(61), 'e'.repeat(61)) }));
    expect(details(long)).toEqual(
      expect.arrayContaining([
        { field: 'body.subtitle.mr', message: 'Subtitle (Marathi) must be at most 60 characters' },
        { field: 'body.subtitle.en', message: 'Subtitle (English) must be at most 60 characters' },
      ]),
    );
    const notAPair = await create(actionBody(22, { subtitle: 'text' }));
    expect(details(notAPair)).toEqual([{ field: 'body.subtitle', message: 'Subtitle must have Marathi and English text' }]);
  });

  it.each([['plug'], ['arrow'], ['close'], ['Plus'], [' plus'], [''], ['<svg onload=alert(1)>'], ['https://example.gov.in/icon.svg']])(
    'refuses the icon %j: only the listed icons are allowed',
    async (icon) => {
      const res = await create(actionBody(23, { icon }));
      expect(res.status).toBe(422);
      expect(details(res)).toEqual([{ field: 'body.icon', message: ICON_HELP }]);
    },
  );

  it('refuses an icon that is not text', async () => {
    for (const icon of [42, null, ['plus']]) {
      const res = await create(actionBody(24, { icon }));
      expect(res.status).toBe(422);
      expect(details(res)).toEqual([{ field: 'body.icon', message: 'Icon must be text' }]);
    }
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
    const res = await create(actionBody(25, { link }));
    expect(res.status).toBe(422);
    expect(details(res)).toEqual([{ field: 'body.link', message }]);
  });

  it('refuses a link set to null: a tile always has a destination', async () => {
    const res = await create(actionBody(25, { link: null }));
    expect(res.status).toBe(422);
    expect(details(res)).toEqual([{ field: 'body.link', message: 'Destination must be text' }]);
  });

  it('refuses unknown fields, a non-boolean status, a bad order, a title that is not a pair and a link that is not text', async () => {
    const res = await create(actionBody(26, { isActive: 'yes', displayOrder: 0, title: 'text', link: 42, html: '<b>x</b>' }));
    expect(res.status).toBe(422);
    expect(
      details(res)
        .map((d) => d.field)
        .sort(),
    ).toEqual(['body', 'body.displayOrder', 'body.isActive', 'body.link', 'body.title']);
    expect(details(res)).toEqual(
      expect.arrayContaining([
        { field: 'body.link', message: 'Destination must be text' },
        { field: 'body.title', message: 'Title must have Marathi and English text' },
        { field: 'body.isActive', message: 'Status must be true or false' },
        { field: 'body.displayOrder', message: 'Display order must be at least 1' },
      ]),
    );
  });

  it('answers 422 for a malformed id and 404 for an unknown one', async () => {
    expect((await request(app).get(`${ADMIN_URL}/nope`).set(auth(admin.token))).status).toBe(422);
    const unknown = '00000000-0000-4000-8000-000000000000';
    const missing = await request(app).get(`${ADMIN_URL}/${unknown}`).set(auth(admin.token));
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('Quick action not found');
    expect((await patch(unknown, { link: '/apply' })).status).toBe(404);
    expect((await request(app).patch(`${ADMIN_URL}/${unknown}/status`).set(auth(admin.token)).send({ isActive: false })).status).toBe(404);
    expect((await remove(unknown)).status).toBe(404);
  });

  it('has no settings endpoint: the strip is shown or hidden only by the "Show on website" switch', async () => {
    /* "settings" is not an id… */
    expect((await request(app).get(`${ADMIN_URL}/settings`).set(auth(admin.token))).status).toBe(422);
    /* …and there is no PUT route under the tiles. */
    expect((await request(app).put(`${ADMIN_URL}/settings`).set(auth(admin.token)).send({ showSection: false })).status).toBe(404);
    expect((await publicFeed())!.showSection).toBe(true);
  });

  it('the database itself refuses an unsafe or missing link, a blank title, a half-filled subtitle, an unlisted icon and a negative order', async () => {
    const insert = (o: {
      titleMr?: string;
      titleEn?: string;
      subtitleMr?: string;
      subtitleEn?: string;
      icon?: string;
      link?: string | null;
      order?: number;
    }) =>
      AppDataSource.query(
        `INSERT INTO "quick_actions" ("titleMr", "titleEn", "subtitleMr", "subtitleEn", "icon", "link", "displayOrder") VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          o.titleMr ?? 'अ',
          o.titleEn ?? 'A',
          o.subtitleMr ?? '',
          o.subtitleEn ?? '',
          o.icon ?? 'plus',
          o.link === undefined ? '/apply' : o.link,
          o.order ?? 1,
        ],
      );
    await expect(insert({ link: 'javascript:alert(1)' })).rejects.toThrow(/CHK_quick_actions_link/);
    await expect(insert({ link: '//evil.example.com' })).rejects.toThrow(/CHK_quick_actions_link/);
    await expect(insert({ link: 'apply' })).rejects.toThrow(/CHK_quick_actions_link/);
    await expect(insert({ link: null })).rejects.toThrow(/null value in column "link"/);
    await expect(insert({ titleMr: '  ' })).rejects.toThrow(/CHK_quick_actions_title_mr/);
    await expect(insert({ titleEn: '' })).rejects.toThrow(/CHK_quick_actions_title_en/);
    await expect(insert({ subtitleMr: 'उपशीर्षक' })).rejects.toThrow(/CHK_quick_actions_subtitle_pair/);
    await expect(insert({ subtitleEn: 'Subtitle' })).rejects.toThrow(/CHK_quick_actions_subtitle_pair/);
    await expect(insert({ icon: 'plug' })).rejects.toThrow(/CHK_quick_actions_icon/);
    await expect(insert({ order: -1 })).rejects.toThrow(/CHK_quick_actions_order/);
    /* One live settings row, ever. */
    await expect(AppDataSource.query(`INSERT INTO "quick_action_settings" DEFAULT VALUES`)).rejects.toThrow(
      /UQ_quick_action_settings_singleton/,
    );
  });
});

describe('Editing a quick action', () => {
  let a: AdminAction;
  beforeAll(async () => {
    a = (await create(actionBody(30, { link: '/faq' })).expect(201)).body.data;
  });

  it('changes only the fields sent', async () => {
    const res = await patch(a.id, { link: '/eligibility' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Quick action updated successfully');
    expect(res.body.data).toMatchObject({
      title: a.title,
      subtitle: a.subtitle,
      icon: a.icon,
      link: '/eligibility',
      displayOrder: a.displayOrder,
    });
    a = res.body.data;
  });

  it('updates title, subtitle, icon and link together, and the website follows', async () => {
    const res = await patch(a.id, {
      title: pair('सुधारित कृती', 'Updated action'),
      subtitle: pair('सुधारित ओळ', 'Updated line'),
      icon: 'calendar',
      link: 'https://example.gov.in/updated',
      expectedUpdatedAt: a.updatedAt,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      title: pair('सुधारित कृती', 'Updated action'),
      subtitle: pair('सुधारित ओळ', 'Updated line'),
      icon: 'calendar',
      link: 'https://example.gov.in/updated',
    });
    expect((await publicActions()).find((x) => x.title.en === 'Updated action')).toEqual({
      title: pair('सुधारित कृती', 'Updated action'),
      subtitle: pair('सुधारित ओळ', 'Updated line'),
      icon: 'calendar',
      link: 'https://example.gov.in/updated',
    });
    a = await get(a.id);
  });

  it('every listed icon is accepted by the API and by the database', async () => {
    for (const icon of QUICK_ACTION_ICONS) {
      const res = await patch(a.id, { icon });
      expect([icon, res.status]).toEqual([icon, 200]);
      expect(res.body.data.icon).toBe(icon);
    }
    a = (await patch(a.id, { icon: 'calendar' }).expect(200)).body.data;
  });

  it('subtitle: null or a blank pair clears it; leaving it out keeps it', async () => {
    const cleared = await patch(a.id, { subtitle: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.subtitle).toEqual(BLANK);
    expect((await publicActions()).find((x) => x.title.en === 'Updated action')!.subtitle).toBeNull();

    await patch(a.id, { subtitle: pair('पुन्हा', 'Again') }).expect(200);
    const blanked = await patch(a.id, { subtitle: pair('  ', ' ') });
    expect(blanked.status).toBe(200);
    expect(blanked.body.data.subtitle).toEqual(BLANK);
    expect((await publicActions()).find((x) => x.title.en === 'Updated action')!.subtitle).toBeNull();

    await patch(a.id, { subtitle: pair('सुधारित ओळ', 'Updated line') }).expect(200);
    const kept = await patch(a.id, { link: 'https://example.gov.in/updated' });
    expect(kept.body.data.subtitle).toEqual(pair('सुधारित ओळ', 'Updated line'));
    a = kept.body.data;
  });

  it('an empty edit changes nothing', async () => {
    const res = await patch(a.id, {});
    expect(res.status).toBe(200);
    expect(await get(a.id)).toEqual(a);
  });

  it('refuses a save over a newer version, and changes nothing', async () => {
    const res = await patch(a.id, { link: '/apply', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(
      'This quick action was changed after you opened it. Reload to see the latest version, then make your changes again.',
    );
    expect(await get(a.id)).toEqual(a);
  });

  it('keeps the saved tile when the database save fails', async () => {
    jest.spyOn(auditService, 'recordInTx').mockRejectedValueOnce(new Error('simulated database failure'));
    const res = await patch(a.id, { title: pair('टिकू नये', 'Must not stick'), link: '/apply' });
    expect(res.status).toBe(500);
    expect(await get(a.id)).toEqual(a);
  });

  it('keeps the saved tile when an invalid edit is refused', async () => {
    expect((await patch(a.id, { title: pair('', ''), link: 'javascript:alert(1)' })).status).toBe(422);
    expect((await patch(a.id, { link: null })).status).toBe(422);
    expect((await patch(a.id, { link: '  ' })).status).toBe(422);
    expect((await patch(a.id, { title: null })).status).toBe(422);
    expect((await patch(a.id, { icon: 'plug' })).status).toBe(422);
    expect((await patch(a.id, { subtitle: pair('फक्त मराठी', '') })).status).toBe(422);
    expect((await patch(a.id, { expectedUpdatedAt: 'yesterday' })).status).toBe(422);
    expect(await get(a.id)).toEqual(a);
  });

  it('records the fields an edit changed', async () => {
    await patch(a.id, { icon: 'clock', link: '/apply' }).expect(200);
    expect(await lastAudit('cms.quick-action.update')).toMatchObject({
      resource: 'quick-action',
      resourceId: a.id,
      details: { fields: ['icon', 'link'] },
    });
    a = await get(a.id);
  });

  it('a hidden tile leaves the website and comes back when shown', async () => {
    const hidden = await request(app).patch(`${ADMIN_URL}/${a.id}/status`).set(auth(admin.token)).send({ isActive: false });
    expect(hidden.status).toBe(200);
    expect(hidden.body.message).toBe('Quick action hidden from the website');
    expect(hidden.body.data.isActive).toBe(false);
    expect((await publicActions()).map((x) => x.title.en)).not.toContain('Updated action');
    expect(await lastAudit('cms.quick-action.status')).toMatchObject({
      resource: 'quick-action',
      resourceId: a.id,
      details: { isActive: false },
    });

    const shown = await request(app).patch(`${ADMIN_URL}/${a.id}/status`).set(auth(admin.token)).send({ isActive: true });
    expect(shown.status).toBe(200);
    expect(shown.body.message).toBe('Quick action shown on the website');
    expect((await publicActions()).map((x) => x.title.en)).toContain('Updated action');

    const bad = await request(app).patch(`${ADMIN_URL}/${a.id}/status`).set(auth(admin.token)).send({ isActive: 'no', icon: 'plus' });
    expect(bad.status).toBe(422);
  });
});

describe('Deleting and ordering', () => {
  it('deletes only the chosen tile: soft-deleted, gone from the website, the rest untouched', async () => {
    const a = (await create(actionBody(40)).expect(201)).body.data as AdminAction;
    const others = (await list()).filter((x) => x.id !== a.id);
    const res = await remove(a.id);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Quick action deleted successfully');
    expect(res.body.data).toBeNull();
    expect(await list()).toEqual(others);
    expect((await publicActions()).map((x) => x.title.en)).not.toContain('Test action 40');
    const [row] = await AppDataSource.query(`SELECT "isDelete", "isActive" FROM "quick_actions" WHERE "id" = $1`, [a.id]);
    expect(row).toEqual({ isDelete: true, isActive: false });
    expect(await lastAudit('cms.quick-action.delete')).toMatchObject({
      resource: 'quick-action',
      resourceId: a.id,
      details: { title: 'Test action 40', link: '/test-40' },
    });
    expect((await remove(a.id)).status).toBe(404);
    expect((await request(app).get(`${ADMIN_URL}/${a.id}`).set(auth(admin.token))).status).toBe(404);
  });

  it('a default tile can be deleted like any other', async () => {
    const training = (await list()).find((r) => r.title.en === 'Training centres')!;
    await remove(training.id).expect(200);
    expect((await publicActions()).map((x) => x.title.en)).not.toContain('Training centres');
  });

  it('reorders by id — the website follows, active ones only — and refuses a stale or duplicated list', async () => {
    const rows = await list();
    const reversed = rows.map((r) => r.id).reverse();
    const res = await request(app).put(`${ADMIN_URL}/order`).set(auth(admin.token)).send({ ids: reversed });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Display order updated successfully');
    expect((res.body.data as AdminAction[]).map((r) => [r.id, r.displayOrder])).toEqual(reversed.map((id, i) => [id, i + 1]));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect((await publicActions()).map((x) => x.title.en)).toEqual(
      reversed
        .map((id) => byId.get(id)!)
        .filter((r) => r.isActive)
        .map((r) => r.title.en),
    );
    expect(await lastAudit('cms.quick-actions.reorder')).toMatchObject({
      resource: 'quick-action',
      resourceId: null,
      details: { order: reversed },
    });

    const stale = await request(app)
      .put(`${ADMIN_URL}/order`)
      .set(auth(admin.token))
      .send({ ids: reversed.slice(1) });
    expect(stale.status).toBe(409);
    expect(stale.body.message).toBe('The quick action list changed after you loaded it. Reload the list, then reorder again.');
    const unknown = await request(app)
      .put(`${ADMIN_URL}/order`)
      .set(auth(admin.token))
      .send({ ids: [...reversed.slice(1), '00000000-0000-4000-8000-000000000000'] });
    expect(unknown.status).toBe(409);
    expect(
      (
        await request(app)
          .put(`${ADMIN_URL}/order`)
          .set(auth(admin.token))
          .send({ ids: [reversed[0], reversed[0]] })
      ).status,
    ).toBe(422);
    expect((await request(app).put(`${ADMIN_URL}/order`).set(auth(admin.token)).send({ ids: [] })).status).toBe(422);
    expect(
      (
        await request(app)
          .put(`${ADMIN_URL}/order`)
          .set(auth(admin.token))
          .send({ ids: ['nope'] })
      ).status,
    ).toBe(422);
    /* The refused lists changed nothing. */
    expect((await list()).map((r) => r.id)).toEqual(reversed);
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
    expect((await request(app).post(ADMIN_URL).send(actionBody(50))).status).toBe(401);
    expect(
      (
        await request(app)
          .put(`${ADMIN_URL}/order`)
          .send({ ids: [id] })
      ).status,
    ).toBe(401);
    expect((await request(app).get(`${ADMIN_URL}/${id}`)).status).toBe(401);
    expect((await request(app).patch(`${ADMIN_URL}/${id}`).send({})).status).toBe(401);
    expect((await request(app).patch(`${ADMIN_URL}/${id}/status`).send({ isActive: false })).status).toBe(401);
    expect((await request(app).delete(`${ADMIN_URL}/${id}`)).status).toBe(401);
  });

  it('a view-only administrator can read but not create, edit, reorder, hide or delete', async () => {
    const viewer = await actorWith(['cms-quickactions.view']);
    const [first] = await list();
    const V = auth(viewer.token);
    expect((await request(app).get(ADMIN_URL).set(V)).status).toBe(200);
    expect((await request(app).get(`${ADMIN_URL}/${first!.id}`).set(V)).status).toBe(200);
    expect((await create(actionBody(51), viewer.token)).status).toBe(403);
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
    expect((await request(app).delete(`${ADMIN_URL}/${first!.id}`).set(V)).status).toBe(403);
    /* Viewing the tab is not flipping its "Show on website" switch. */
    expect((await request(app).put(SWITCH_URL).set(V).send({ visible: false })).status).toBe(403);
    expect(await get(first!.id)).toEqual(first);
    expect((await publicFeed())!.showSection).toBe(true);
  });

  it('create, update and delete are separate permissions', async () => {
    const creator = await actorWith(['cms-quickactions.view', 'cms-quickactions.create']);
    const created = await create(actionBody(52), creator.token);
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect((await request(app).patch(`${ADMIN_URL}/${id}`).set(auth(creator.token)).send({ link: '/apply' })).status).toBe(403);
    expect((await request(app).delete(`${ADMIN_URL}/${id}`).set(auth(creator.token))).status).toBe(403);

    const deleter = await actorWith(['cms-quickactions.delete']);
    expect((await request(app).get(ADMIN_URL).set(auth(deleter.token))).status).toBe(403);
    expect((await request(app).delete(`${ADMIN_URL}/${id}`).set(auth(deleter.token))).status).toBe(200);
  });

  it('another CMS permission does not open this section', async () => {
    const other = await actorWith(['cms-schemes.view', 'cms-schemes.update']);
    expect((await request(app).get(ADMIN_URL).set(auth(other.token))).status).toBe(403);
    /* Nor do the neighbouring Top Bar and Home Hero tabs. */
    const topBar = await actorWith(['cms-topbar.view', 'cms-topbar.create', 'cms-topbar.update', 'cms-topbar.delete']);
    expect((await request(app).get(ADMIN_URL).set(auth(topBar.token))).status).toBe(403);
    expect((await create(actionBody(53), topBar.token)).status).toBe(403);
    const hero = await actorWith(['cms-hero.view', 'cms-hero.update']);
    expect((await request(app).get(ADMIN_URL).set(auth(hero.token))).status).toBe(403);
    expect((await request(app).put(SWITCH_URL).set(auth(hero.token)).send({ visible: false })).status).toBe(403);
  });

  it('a Website Admin manages it end to end: add, edit, hide, reorder, switch the strip and delete', async () => {
    const user = await createUser({ roleCodes: [ROLE_CODES.WEBSITE_ADMIN] });
    const W = auth(await login(user.email));
    const created = await request(app)
      .post(ADMIN_URL)
      .set(W)
      .send({ title: pair('वेबसाइट कृती', 'Website action'), icon: 'globe', link: '/apply' });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect((await request(app).get(ADMIN_URL).set(W)).status).toBe(200);
    expect((await request(app).get(`${ADMIN_URL}/${id}`).set(W)).status).toBe(200);
    const edited = await request(app)
      .patch(`${ADMIN_URL}/${id}`)
      .set(W)
      .send({ link: 'www.example.gov.in', subtitle: pair('ओळ', 'Line') });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ link: 'https://www.example.gov.in', subtitle: pair('ओळ', 'Line') });
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
    expect((await request(app).put(SWITCH_URL).set(W).send({ visible: false })).status).toBe(200);
    expect(await publicFeed()).toEqual({ showSection: false, actions: [] });
    expect((await request(app).put(SWITCH_URL).set(W).send({ visible: true })).status).toBe(200);
    expect((await request(app).delete(`${ADMIN_URL}/${id}`).set(W)).status).toBe(200);
  });
});
