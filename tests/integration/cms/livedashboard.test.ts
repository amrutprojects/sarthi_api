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
import { CmsLiveDashboard1797600000000 } from '../../../src/database/migrations/1797600000000-CmsLiveDashboard';
import { RemoveDemoWording1797900000000 } from '../../../src/database/migrations/1797900000000-RemoveDemoWording';
import { auditService } from '../../../src/modules/audit/audit.service';

const ADMIN_URL = `${API}/cms/live-dashboard`;
const PUBLIC_URL = `${API}/public/live-dashboard`;
const SWITCH_URL = `${API}/cms/section-visibility/live-dashboard`;

let app: Express;
let admin: TestActor;

interface Pair {
  mr: string;
  en: string;
}
interface Detail {
  field: string;
  message: string;
}
interface AdminRow {
  id: string;
  label: Pair;
  value: string;
  displayOrder: number;
  isActive: boolean;
  updatedAt: string;
  detail?: Pair;
  link?: string;
  tone?: string;
}
interface AdminDistrict {
  id: string;
  code: string;
  name: Pair;
  status: string;
  target: number;
  enrolled: number;
  trainingActive: number;
  completed: number;
  certified: number;
  attendancePct: number;
  displayOrder: number;
  updatedAt: string;
}
interface Feed {
  showSection: boolean;
  heading: Pair;
  subtitle: Pair | null;
  disclaimer: Pair | null;
  cards: { id: string; label: Pair; value: string; detail: Pair | null; link: string | null; tone: string }[];
  map: { title: Pair; districts: (Omit<AdminDistrict, 'id' | 'displayOrder' | 'updatedAt'>)[] } | null;
  modes: {
    title: Pair;
    offline: { label: Pair; count: number };
    online: { label: Pair; count: number };
    centerLabel: Pair;
    stats: { id: string; label: Pair; value: string }[];
  } | null;
}

const pair = (mr: string, en: string): Pair => ({ mr, en });

/* What the home page printed from its bundled demo dataset before it was managed — the rows the migration inserts. */
const HEADING = pair('कार्यक्रम प्रगती - थेट माहितीफलक', 'Programme Progress - Live Dashboard');
const SUBTITLE = pair(
  'अमृत कलश अंतर्गत महाराष्ट्रातील ३६ जिल्ह्यांमधील प्रशिक्षण प्रगतीचा सार्वजनिक आढावा.',
  'Public view of AMRUT Kalash training progress across all 36 districts of Maharashtra.',
);
/* The note under the section: blank in both languages, since RemoveDemoWording cleared the one the migration inserted. */
const DISCLAIMER = pair('', '');
const CARDS = [
  { label: pair('एकूण लक्ष्य', 'Total target'), value: '2,000', detail: pair('विद्यार्थी', 'students'), link: '/programme', tone: 'blue' },
  {
    label: pair('प्राप्त अर्ज', 'Applications'),
    value: '1,245',
    detail: pair('नोंदणी झालेली', 'registrations received'),
    link: '/track',
    tone: 'default',
  },
  {
    label: pair('पात्र उमेदवार', 'Eligible'),
    value: '1,080',
    detail: pair('87% अर्जांपैकी', '87% of applications'),
    link: '/eligibility',
    tone: 'blue',
  },
  { label: pair('प्रवेशित', 'Enrolled'), value: '1,000', detail: pair('100% लक्ष्यापैकी', '100% of target'), link: '/programme', tone: 'green' },
  {
    label: pair('प्रशिक्षण सुरू', 'Training active'),
    value: '760',
    detail: pair('600 ऑफलाइन · 160 ऑनलाइन', '600 offline · 160 online'),
    link: '/verify',
    tone: 'default',
  },
  { label: pair('प्रशिक्षण पूर्ण', 'Completed'), value: '240', detail: pair('24% पूर्णत्व दर', '24% completion rate'), link: '/verify', tone: 'green' },
  { label: pair('मूल्यमापन झालेले', 'Assessed'), value: '180', detail: pair('92% उत्तीर्ण दर', '92% pass rate'), link: '/verify', tone: 'violet' },
  { label: pair('प्रमाणित', 'Certified'), value: '165', detail: pair('प्रमाणपत्रे दिली', 'certificates issued'), link: '/verify', tone: 'green' },
];
const STATS = [
  { label: pair('मंजूर प्रशिक्षण केंद्रे', 'Approved centres'), value: '10' },
  { label: pair('कार्यरत बॅचेस', 'Active batches'), value: '15' },
  { label: pair('प्रशिक्षक', 'Trainers'), value: '12' },
  { label: pair('सरासरी उपस्थिती', 'Average attendance'), value: '78%' },
  { label: pair('प्रगतीपथावरील जिल्हे', 'Districts on track'), value: '21 / 36' },
];
/* The website's 36 map tiles, in its dataset order. */
const CODES = [
  'NDB', 'DHU', 'JAL', 'BUL', 'AKO', 'AMR', 'NAG', 'BHA', 'GON', 'PAL', 'NAS', 'WAS', 'YAV', 'WAR', 'CHA', 'GAD', 'MUS', 'THA',
  'CSN', 'JLN', 'HIN', 'PAR', 'NAN', 'MUC', 'RAI', 'PUN', 'AHL', 'BEE', 'LAT', 'DHA', 'RAT', 'SAT', 'SOL', 'SIN', 'KOL', 'SAN',
];
const PUNE = {
  code: 'PUN',
  name: pair('पुणे', 'Pune'),
  status: 'TRAINING_ACTIVE',
  target: 80,
  enrolled: 80,
  trainingActive: 0,
  completed: 80,
  certified: 56,
  attendancePct: 86,
};
const MODES = {
  title: pair('प्रशिक्षण पद्धती', 'Training modes'),
  offline: { label: pair('ऑफलाइन (केंद्र)', 'Offline (centre)'), count: 800 },
  online: { label: pair('ऑनलाइन (केंद्रीय)', 'Online (central)'), count: 200 },
  centerLabel: pair('प्रवेशित', 'Enrolled'),
};
const MAP_TITLE = pair('जिल्हानिहाय प्रगती — महाराष्ट्र', 'District-wise progress — Maharashtra');

/* A valid settings body: the migration's values, which a test then changes field by field. */
const SETTINGS_BODY = {
  heading: HEADING,
  subtitle: SUBTITLE,
  disclaimer: DISCLAIMER,
  showDisclaimer: true,
  mapTitle: MAP_TITLE,
  showMap: true,
  modesTitle: MODES.title,
  showModes: true,
  offlineLabel: MODES.offline.label,
  onlineLabel: MODES.online.label,
  offlineCount: 800,
  onlineCount: 200,
  donutCenterLabel: MODES.centerLabel,
};

const details = (res: { body: { error: { details: Detail[] } } }) => res.body.error.details;
const get = async <T>(path: string): Promise<T> => (await request(app).get(`${ADMIN_URL}${path}`).set(auth(admin.token)).expect(200)).body.data;
const send = (method: 'post' | 'put' | 'patch' | 'delete', path: string, payload?: unknown, token = admin.token) => {
  const agent = request(app);
  return agent[method](`${ADMIN_URL}${path}`)
    .set(auth(token))
    .send(payload as object);
};
const feed = async () => (await request(app).get(PUBLIC_URL).expect(200)).body.data as Feed | null;
const lastAudit = async (action: string) =>
  (
    await AppDataSource.query(
      `SELECT "resource", "resourceId", "details", "actorUserId" FROM "audit_logs" WHERE "action" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
      [action],
    )
  )[0] as { resource: string; resourceId: string | null; details: Record<string, unknown>; actorUserId: string } | undefined;

/*
 * The four tables survive resetData() (their rows come from the migration), so this file starts from
 * and leaves behind exactly what the migration makes: its down() and up() rebuild them.
 */
async function rebuild(): Promise<void> {
  const qr = AppDataSource.createQueryRunner();
  try {
    const migration = new CmsLiveDashboard1797600000000();
    await migration.down(qr);
    await migration.up(qr);
    /* ...then what a later migration did to its rows: RemoveDemoWording cleared the seeded note. */
    await new RemoveDemoWording1797900000000().up(qr);
  } finally {
    await qr.release();
  }
}

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
  await rebuild();
});
afterAll(async () => {
  await rebuild();
  await teardownTestApp();
});
afterEach(() => jest.restoreAllMocks());

describe('The dashboard the migration creates', () => {
  it('feeds the website exactly what it showed before: heading, texts, the 8 cards, the map, the donut and its 5 figures', async () => {
    const res = await request(app).get(PUBLIC_URL);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Live dashboard retrieved successfully');
    const data = res.body.data as Feed;
    expect(Object.keys(data).sort()).toEqual(['cards', 'disclaimer', 'heading', 'map', 'modes', 'showSection', 'subtitle']);
    /* No note: the seeded "DEMO ENVIRONMENT - SAMPLE DATA" note was cleared by RemoveDemoWording. */
    expect(data).toMatchObject({ showSection: true, heading: HEADING, subtitle: SUBTITLE, disclaimer: null });
    expect(data.cards.map(({ id: _id, ...c }) => c)).toEqual(CARDS);
    expect(data.map!.title).toEqual(MAP_TITLE);
    expect(data.map!.districts.map((d) => d.code)).toEqual(CODES);
    expect(data.map!.districts.find((d) => d.code === 'PUN')).toEqual(PUNE);
    /* "Districts on track" counts the green statuses: the figure and the map agree. */
    expect(data.map!.districts.filter((d) => ['TRAINING_ACTIVE', 'COMPLETED'].includes(d.status))).toHaveLength(21);
    expect(data.modes).toMatchObject(MODES);
    expect(data.modes!.stats.map(({ id: _id, ...s }) => s)).toEqual(STATS);
  });

  it('gives the admin panel the same content, with every row shown and in order', async () => {
    const settings = await get<Record<string, unknown>>('/settings');
    expect(settings).toMatchObject({ ...SETTINGS_BODY, showSection: true });
    const cards = await get<AdminRow[]>('/cards');
    expect(cards.map(({ label, value, detail, link, tone, displayOrder, isActive }) => ({ label, value, detail, link, tone, displayOrder, isActive }))).toEqual(
      CARDS.map((c, i) => ({ ...c, displayOrder: i + 1, isActive: true })),
    );
    const stats = await get<AdminRow[]>('/stats');
    expect(stats.map(({ label, value, displayOrder, isActive }) => ({ label, value, displayOrder, isActive }))).toEqual(
      STATS.map((s, i) => ({ ...s, displayOrder: i + 1, isActive: true })),
    );
    const districts = await get<AdminDistrict[]>('/districts');
    expect(districts.map((d) => d.code)).toEqual(CODES);
    expect(districts.find((d) => d.code === 'PUN')).toMatchObject({ ...PUNE, displayOrder: 26 });
    expect(Object.keys(districts[0]!).sort()).toEqual([
      'attendancePct',
      'certified',
      'code',
      'completed',
      'createdAt',
      'displayOrder',
      'enrolled',
      'id',
      'name',
      'status',
      'target',
      'trainingActive',
      'updatedAt',
    ]);
  });
});

describe('The public feed', () => {
  it('is null while the dashboard is not configured or its settings row is inactive, and needs no session', async () => {
    await AppDataSource.query(`UPDATE "live_dashboard_settings" SET "isDelete" = true`);
    try {
      const res = await request(app).get(PUBLIC_URL);
      expect(res.body).toMatchObject({ data: null, message: 'The live dashboard is not configured' });
      expect((await send('put', '/settings', SETTINGS_BODY)).status).toBe(404);
    } finally {
      await AppDataSource.query(`UPDATE "live_dashboard_settings" SET "isDelete" = false`);
    }
    await AppDataSource.query(`UPDATE "live_dashboard_settings" SET "isActive" = false`);
    try {
      expect(await feed()).toBeNull();
    } finally {
      await AppDataSource.query(`UPDATE "live_dashboard_settings" SET "isActive" = true`);
    }
    expect((await feed())!.showSection).toBe(true);
  });

  it('the "Show on website" switch hides the whole section: no cards, no map, no modes — never null', async () => {
    const off = await request(app).put(SWITCH_URL).set(auth(admin.token)).send({ visible: false });
    expect(off.status).toBe(200);
    expect(off.body.data).toMatchObject({ key: 'live-dashboard', menu: 'cms-livedashboard', visible: false, configured: true });
    expect(await feed()).toMatchObject({ showSection: false, cards: [], map: null, modes: null });
    expect((await get<{ showSection: boolean }>('/settings')).showSection).toBe(false);
    await request(app).put(SWITCH_URL).set(auth(admin.token)).send({ visible: true }).expect(200);
    expect((await feed())!.cards).toHaveLength(CARDS.length);
  });

  it('leaves out each part that is switched off, and a hidden card or figure', async () => {
    const { updatedAt } = await get<{ updatedAt: string }>('/settings');
    await send('put', '/settings', { ...SETTINGS_BODY, showMap: false, showModes: false, showDisclaimer: false, expectedUpdatedAt: updatedAt }).expect(
      200,
    );
    expect(await feed()).toMatchObject({ showSection: true, map: null, modes: null, disclaimer: null });
    await send('put', '/settings', SETTINGS_BODY).expect(200);

    const [card] = await get<AdminRow[]>('/cards');
    const [stat] = await get<AdminRow[]>('/stats');
    await send('patch', `/cards/${card!.id}/status`, { isActive: false }).expect(200);
    await send('patch', `/stats/${stat!.id}/status`, { isActive: false }).expect(200);
    const f = (await feed())!;
    expect(f.cards.map((c) => c.id)).not.toContain(card!.id);
    expect(f.modes!.stats.map((s) => s.id)).not.toContain(stat!.id);
    await send('patch', `/cards/${card!.id}/status`, { isActive: true }).expect(200);
    await send('patch', `/stats/${stat!.id}/status`, { isActive: true }).expect(200);
    expect((await feed())!.cards[0]!.id).toBe(card!.id);
  });
});

describe('Settings', () => {
  it('saves every field, trims the text, turns a blank optional text into none, and records who did it', async () => {
    const before = await get<{ updatedAt: string }>('/settings');
    const res = await send('put', '/settings', {
      ...SETTINGS_BODY,
      heading: pair('  नवीन   शीर्षक ', ' New   heading '),
      subtitle: pair('', ''),
      disclaimer: null,
      offlineCount: 900,
      onlineCount: 300,
      expectedUpdatedAt: before.updatedAt,
    });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Dashboard settings updated successfully');
    expect(res.body.data).toMatchObject({
      heading: pair('नवीन शीर्षक', 'New heading'),
      subtitle: pair('', ''),
      disclaimer: pair('', ''),
      offlineCount: 900,
      onlineCount: 300,
    });
    expect(await feed()).toMatchObject({ heading: pair('नवीन शीर्षक', 'New heading'), subtitle: null, disclaimer: null });
    expect((await feed())!.modes).toMatchObject({ offline: { count: 900 }, online: { count: 300 } });
    expect(await lastAudit('cms.live-dashboard.settings.update')).toMatchObject({
      resource: 'live-dashboard-settings',
      resourceId: res.body.data.id,
      actorUserId: admin.user.id,
    });

    /* A screen opened before that save must reload. */
    const stale = await send('put', '/settings', { ...SETTINGS_BODY, expectedUpdatedAt: before.updatedAt });
    expect(stale.status).toBe(409);
    await send('put', '/settings', SETTINGS_BODY).expect(200);
  });

  it('refuses showSection (the switch owns it), a missing or half-filled text and a bad count, naming the field', async () => {
    const withFlag = await send('put', '/settings', { ...SETTINGS_BODY, showSection: false });
    expect(withFlag.status).toBe(422);
    expect(details(withFlag).map((d) => d.field)).toEqual(['body']);

    const { heading: _h, ...noHeading } = SETTINGS_BODY;
    expect(details(await send('put', '/settings', noHeading))).toEqual([{ field: 'body.heading', message: 'Heading is required' }]);

    const half = await send('put', '/settings', { ...SETTINGS_BODY, disclaimer: pair('फक्त मराठी', '') });
    expect(details(half)).toEqual([
      { field: 'body.disclaimer.en', message: 'Disclaimer (English) is required when the Marathi text is filled in' },
    ]);

    const counts = await send('put', '/settings', { ...SETTINGS_BODY, offlineCount: -1, onlineCount: 2.5 });
    expect(details(counts)).toEqual([
      { field: 'body.offlineCount', message: 'Offline count must not be negative' },
      { field: 'body.onlineCount', message: 'Online count must be a whole number' },
    ]);

    const long = await send('put', '/settings', { ...SETTINGS_BODY, donutCenterLabel: pair('क'.repeat(41), 'Enrolled') });
    expect(details(long)).toEqual([{ field: 'body.donutCenterLabel.mr', message: 'Donut centre label (Marathi) must be at most 40 characters' }]);
    expect((await feed())!.heading).toEqual(HEADING);
  });
});

describe('KPI cards', () => {
  it('adds a card at the end with the defaults, edits only what is sent, hides, reorders and deletes it', async () => {
    const created = await send('post', '/cards', { label: pair(' नवीन ', ' New card '), value: ' 42 ' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      label: pair('नवीन', 'New card'),
      value: '42',
      detail: pair('', ''),
      link: '',
      tone: 'default',
      displayOrder: CARDS.length + 1,
      isActive: true,
    });
    const id = created.body.data.id as string;
    expect(await lastAudit('cms.live-dashboard.card.create')).toMatchObject({ resource: 'live-dashboard-card', resourceId: id });
    /* No link: the website prints a plain card. No detail: no small line. */
    expect((await feed())!.cards.at(-1)).toEqual({ id, label: pair('नवीन', 'New card'), value: '42', detail: null, link: null, tone: 'default' });

    const edited = await send('patch', `/cards/${id}`, { detail: pair('तपशील', 'Detail'), link: '/apply?x=1#top', tone: 'violet' });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ label: pair('नवीन', 'New card'), detail: pair('तपशील', 'Detail'), link: '/apply?x=1#top', tone: 'violet' });

    const stale = await send('patch', `/cards/${id}`, { value: '43', expectedUpdatedAt: created.body.data.updatedAt });
    expect(stale.status).toBe(409);

    const ids = (await get<AdminRow[]>('/cards')).map((c) => c.id);
    const moved = await send('put', '/cards/order', { ids: [id, ...ids.filter((x) => x !== id)] });
    expect(moved.status).toBe(200);
    expect((moved.body.data as AdminRow[]).map((c) => [c.id, c.displayOrder])[0]).toEqual([id, 1]);
    expect((await feed())!.cards[0]!.id).toBe(id);
    /* A list that leaves a card out is a stale screen. */
    expect((await send('put', '/cards/order', { ids: ids.slice(1) })).status).toBe(409);

    expect((await send('delete', `/cards/${id}`)).status).toBe(200);
    expect((await send('patch', `/cards/${id}`, { value: '1' })).status).toBe(404);
    expect((await request(app).get(`${ADMIN_URL}/cards/${id}`).set(auth(admin.token))).status).toBe(404);
    await send('put', '/cards/order', { ids: ids.filter((x) => x !== id) }).expect(200);
    expect((await feed())!.cards.map(({ id: _id, ...c }) => c)).toEqual(CARDS);
  });

  it('refuses an outside or unsafe link, an unknown tone and a blank value, naming the field', async () => {
    for (const link of ['https://example.gov.in', '//evil.example', 'javascript:alert(1)', '/a b']) {
      const res = await send('post', '/cards', { label: pair('क', 'K'), value: '1', link });
      expect([link, res.status, details(res).map((d) => d.field)]).toEqual([link, 422, ['body.link']]);
    }
    const tone = await send('post', '/cards', { label: pair('क', 'K'), value: '1', tone: 'red' });
    expect(details(tone)).toEqual([{ field: 'body.tone', message: 'Tone must be one of: default, blue, green, violet' }]);
    const blank = await send('post', '/cards', { label: pair('क', 'K'), value: '  ' });
    expect(details(blank)).toEqual([{ field: 'body.value', message: 'Value is required' }]);
    const long = await send('post', '/cards', { label: pair('क', 'K'), value: '1'.repeat(21) });
    expect(details(long)).toEqual([{ field: 'body.value', message: 'Value must be at most 20 characters' }]);
    expect(await get<AdminRow[]>('/cards')).toHaveLength(CARDS.length);
  });
});

describe('Side figures', () => {
  it('adds, edits, reorders and deletes a figure', async () => {
    const created = await send('post', '/stats', { label: pair('नवीन आकडा', 'New figure'), value: '5 / 10', isActive: false });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ value: '5 / 10', displayOrder: STATS.length + 1, isActive: false });
    const id = created.body.data.id as string;
    expect((await feed())!.modes!.stats).toHaveLength(STATS.length);

    const edited = await send('patch', `/stats/${id}`, { value: '6 / 10', isActive: true });
    expect(edited.body.data).toMatchObject({ label: pair('नवीन आकडा', 'New figure'), value: '6 / 10', isActive: true });
    expect((await feed())!.modes!.stats.at(-1)).toEqual({ id, label: pair('नवीन आकडा', 'New figure'), value: '6 / 10' });

    const ids = (await get<AdminRow[]>('/stats')).map((s) => s.id);
    await send('put', '/stats/order', { ids: [...ids].reverse() }).expect(200);
    expect((await feed())!.modes!.stats[0]!.id).toBe(id);
    await send('delete', `/stats/${id}`).expect(200);
    await send('put', '/stats/order', { ids: ids.filter((x) => x !== id) }).expect(200);
    expect((await feed())!.modes!.stats.map(({ id: _id, ...s }) => s)).toEqual(STATS);
    expect(await lastAudit('cms.live-dashboard.stat.delete')).toMatchObject({ resource: 'live-dashboard-stat', resourceId: id });

    const bad = await send('post', '/stats', { label: pair('क', ''), value: '1' });
    expect(details(bad)).toEqual([{ field: 'body.label.en', message: 'Label (English) is required' }]);
  });
});

describe('Districts', () => {
  it("edits a district's status and figures by its code, leaving the rest alone", async () => {
    const before = (await get<AdminDistrict[]>('/districts')).find((d) => d.code === 'PUN')!;
    const res = await send('patch', '/districts/pun', { status: 'COMPLETED', certified: 70, attendancePct: 90, expectedUpdatedAt: before.updatedAt });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ ...PUNE, status: 'COMPLETED', certified: 70, attendancePct: 90 });
    expect((await feed())!.map!.districts.find((d) => d.code === 'PUN')).toEqual({ ...PUNE, status: 'COMPLETED', certified: 70, attendancePct: 90 });
    expect(await lastAudit('cms.live-dashboard.district.update')).toMatchObject({
      resource: 'live-dashboard-district',
      resourceId: before.id,
      details: { code: 'PUN', status: 'COMPLETED', certified: 70, attendancePct: 90 },
    });

    expect((await send('patch', '/districts/PUN', { target: 1, expectedUpdatedAt: before.updatedAt })).status).toBe(409);
    await send('patch', '/districts/PUN', { status: PUNE.status, certified: PUNE.certified, attendancePct: PUNE.attendancePct }).expect(200);
  });

  it('refuses an unknown district, status or out-of-range figure', async () => {
    expect((await send('patch', '/districts/XYZ', { target: 1 })).status).toBe(404);
    expect(details(await send('patch', '/districts/PUNE', { target: 1 })).map((d) => d.field)).toEqual(['params.code']);
    const bad = await send('patch', '/districts/PUN', { status: 'DONE', enrolled: -1, attendancePct: 101 });
    expect(details(bad).map((d) => d.field)).toEqual(['body.status', 'body.enrolled', 'body.attendancePct']);
    expect(details(await send('patch', '/districts/PUN', { name: pair('क', 'K') })).map((d) => d.field)).toEqual(['body']);
    /* The 36 districts are fixed: there is no route to add or delete one. */
    expect((await send('post', '/districts', { code: 'NEW' })).status).toBe(404);
  });
});

describe('Permissions', () => {
  it('needs a session for the admin routes, and the menu permission for each action', async () => {
    expect((await request(app).get(`${ADMIN_URL}/settings`)).status).toBe(401);

    const viewer = await actorWith(['cms-livedashboard.view']);
    for (const p of ['/settings', '/cards', '/stats', '/districts']) {
      expect((await request(app).get(`${ADMIN_URL}${p}`).set(auth(viewer.token))).status).toBe(200);
    }
    expect((await send('put', '/settings', SETTINGS_BODY, viewer.token)).status).toBe(403);
    expect((await send('patch', '/districts/PUN', { target: 1 }, viewer.token)).status).toBe(403);
    expect((await send('post', '/cards', { label: pair('क', 'K'), value: '1' }, viewer.token)).status).toBe(403);
    expect((await request(app).put(SWITCH_URL).set(auth(viewer.token)).send({ visible: false })).status).toBe(403);

    const editor = await actorWith(['cms-livedashboard.view', 'cms-livedashboard.update']);
    const [card] = await get<AdminRow[]>('/cards');
    expect((await send('delete', `/cards/${card!.id}`, undefined, editor.token)).status).toBe(403);
    expect((await send('post', '/stats', { label: pair('क', 'K'), value: '1' }, editor.token)).status).toBe(403);
    expect((await send('patch', `/cards/${card!.id}`, { value: card!.value }, editor.token)).status).toBe(200);

    const other = await actorWith(['cms-impact.view']);
    expect((await request(app).get(`${ADMIN_URL}/cards`).set(auth(other.token))).status).toBe(403);
  });

  it('rolls a change back when its audit entry cannot be written', async () => {
    jest.spyOn(auditService, 'recordInTx').mockRejectedValueOnce(new Error('simulated database failure'));
    expect((await send('patch', '/districts/NDB', { target: 999 })).status).toBe(500);
    expect((await get<AdminDistrict[]>('/districts')).find((d) => d.code === 'NDB')!.target).toBe(8);
  });
});
