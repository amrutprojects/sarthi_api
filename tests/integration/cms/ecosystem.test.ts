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
import { seedEcosystem } from '../../../src/database/seeds/seed-ecosystem';
import { auditService } from '../../../src/modules/audit/audit.service';

const ADMIN_URL = `${API}/cms/ecosystem`;
const PUBLIC_URL = `${API}/public/ecosystem`;

let app: Express;
let admin: TestActor;

interface Pair {
  mr: string;
  en: string;
}
interface AdminProgramme {
  id: string;
  name: Pair;
  description: Pair;
  icon: string;
  link: string | null;
  linkLabel: Pair;
  displayOrder: number;
  isActive: boolean;
  updatedAt: string;
}
interface Detail {
  field: string;
  message: string;
}

const pair = (mr: string, en: string): Pair => ({ mr, en });
const BLANK = pair('', '');
const DEFAULT_LABEL = pair('अधिक जाणून घ्या →', 'Learn more →');

/* The eight cards the website showed before the section was managed (content/verticals.ts), in order. */
const SEEDED = [
  { name: pair('अमृत विद्या', 'AMRUT Vidya'), description: pair('ज्ञानार्जनाचा परिपूर्ण मंच', 'A complete platform for learning'), icon: 'teacher', link: null },
  { name: pair('अमृत पेठ', 'AMRUT Peth'), description: pair('दर्जेदार व किफायतशीर उत्पादनांसाठी', 'Quality and affordable products'), icon: 'building', link: null },
  { name: pair('अमृत महाराष्ट्र', 'AMRUT Maharashtra'), description: pair('राज्य विकास उपक्रम', 'State development initiative'), icon: 'map', link: null },
  { name: pair('अमृत मानसमित्र', 'AMRUT Manasmitra'), description: pair('मनातल्या प्रत्येक भावनेसाठी', 'For every emotion within'), icon: 'users', link: null },
  { name: pair('अमृत पर्यटन', 'AMRUT Tourism'), description: pair('पाहा महाराष्ट्र.. अमृतच्या नजरेतून', 'See Maharashtra through AMRUT'), icon: 'globe', link: null },
  { name: pair('अमृत वर्ग', 'AMRUT Varg'), description: pair('विशेष गट उपक्रम', 'Special group initiative'), icon: 'layers', link: null },
  { name: pair('अमृत ड्रोन मिशन', 'AMRUT Drone Mission'), description: pair('भारतीय आकाशाला सशक्त करणे', 'Empowering Indian skies'), icon: 'play', link: null },
  { name: pair('सारथी', 'Sarthi'), description: pair('कौशल्य विकास व रोजगारक्षमता', 'Skill development & employability'), icon: 'award', link: '/programme' },
];

const programme = (n: number, extra: Record<string, unknown> = {}) => ({
  name: pair(`अमृत प्रणाली चाचणी ${n}`, `Ecosystem Test ${n}`),
  description: pair('मराठी चाचणी वर्णन — ज्ञ, क्ष', 'Test description'),
  icon: 'monitor',
  ...extra,
});

const details = (res: { body: { error: { details: Detail[] } } }) => res.body.error.details;
const list = async (): Promise<AdminProgramme[]> => (await request(app).get(ADMIN_URL).set(auth(admin.token)).expect(200)).body.data;
const publicCards = async () => (await request(app).get(PUBLIC_URL).expect(200)).body.data.programmes as Record<string, unknown>[];
const create = (payload: unknown, token = admin.token) => request(app).post(ADMIN_URL).set(auth(token)).send(payload as object);
const patch = (id: string, payload: unknown) => request(app).patch(`${ADMIN_URL}/${id}`).set(auth(admin.token)).send(payload as object);
const countRows = async () => (await AppDataSource.query(`SELECT count(*)::int AS n FROM "ecosystem_programmes" WHERE "isDelete" = false`))[0].n as number;

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
});
afterAll(teardownTestApp);
afterEach(() => jest.restoreAllMocks());

describe('AMRUT Ecosystem — before the seed', () => {
  it('the public feed is null while the section is not configured', async () => {
    expect((await request(app).get(PUBLIC_URL).expect(200)).body.data).toBeNull();
    expect((await request(app).get(`${ADMIN_URL}/settings`).set(auth(admin.token))).status).toBe(404);
  });
});

describe('AMRUT Ecosystem seed', () => {
  it('seeds exactly the eight cards, heading, subtitle and link label the website showed', async () => {
    expect(await seedEcosystem(AppDataSource)).toEqual({ created: true, programmesCreated: 8 });
    const rows = await list();
    expect(rows.map(({ name, description, icon, link }) => ({ name, description, icon, link }))).toEqual(SEEDED);
    expect(rows.map((r) => [r.displayOrder, r.isActive, r.linkLabel])).toEqual(SEEDED.map((_, i) => [i + 1, true, BLANK]));

    const pub = (await request(app).get(PUBLIC_URL).expect(200)).body.data;
    expect(pub).toMatchObject({
      heading: pair('अमृत प्रणाली', 'The AMRUT Ecosystem'),
      subtitle: pair('अमृत अंतर्गत विविध विभाग व उपक्रम', 'Departments and initiatives under AMRUT'),
      showSection: true,
    });
    expect(pub.programmes.map(({ id: _id, ...card }: Record<string, unknown>) => card)).toEqual(SEEDED.map((s) => ({ ...s, linkLabel: DEFAULT_LABEL })));
  });

  it('is idempotent and never brings back a deleted card', async () => {
    const [first] = await list();
    await request(app).delete(`${ADMIN_URL}/${first!.id}`).set(auth(admin.token)).expect(200);
    expect(await seedEcosystem(AppDataSource)).toEqual({ created: false, programmesCreated: 0 });
    expect((await list()).map((r) => r.id)).not.toContain(first!.id);
    /* Put the card back for the rest of the suite, as a new record. */
    await create({ ...SEEDED[0], displayOrder: 1 }).expect(201);
  });
});

describe('Adding a programme', () => {
  it('adds a ninth card at the end, trims the text and keeps Marathi intact', async () => {
    const res = await create(programme(1, { name: pair('  अमृत प्रणाली   चाचणी 1 ', 'Ecosystem Test 1'), link: '/apply' }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: pair('अमृत प्रणाली चाचणी 1', 'Ecosystem Test 1'),
      description: pair('मराठी चाचणी वर्णन — ज्ञ, क्ष', 'Test description'),
      icon: 'monitor',
      link: '/apply',
      linkLabel: BLANK,
      isActive: true,
      displayOrder: 9,
    });
    const cards = await publicCards();
    expect(cards).toHaveLength(9);
    expect(cards[8]).toMatchObject({ name: pair('अमृत प्रणाली चाचणी 1', 'Ecosystem Test 1'), linkLabel: DEFAULT_LABEL, link: '/apply' });
  });

  it('supports more cards than the original eight, an external address and its own link label', async () => {
    for (const n of [2, 3]) await create(programme(n, { link: `https://example.gov.in/p${n}`, linkLabel: pair('भेट द्या', 'Visit') })).expect(201);
    const cards = await publicCards();
    expect(cards).toHaveLength(11);
    expect(cards[10]).toMatchObject({ link: 'https://example.gov.in/p3', linkLabel: pair('भेट द्या', 'Visit') });
  });

  it('refuses a duplicate name (either language, any case)', async () => {
    const res = await create(programme(9, { name: pair('सारथी', 'Something else') }));
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('A programme named "सारथी" / "Sarthi" already exists.');
    expect((await create(programme(9, { name: pair('नवीन', 'sARTHI') }))).status).toBe(409);
  });

  it('replays a double-submitted form (same Idempotency-Key) instead of adding the card twice', async () => {
    const before = await countRows();
    const send = () => create(programme(4)).set('Idempotency-Key', 'ecosystem-test-key-0004');
    const first = await send();
    const second = await send();
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await countRows()).toBe(before + 1);
  });
});

describe('Validation', () => {
  it('names each missing field', async () => {
    const res = await create({ description: pair('', 'x') });
    expect(res.status).toBe(422);
    expect(details(res).map((d) => d.field).sort()).toEqual(['body.description.mr', 'body.icon', 'body.name']);
    expect(details(res)).toContainEqual({ field: 'body.name', message: 'Programme name is required' });
  });

  it('refuses blank halves, an over-long name and a half-filled link label', async () => {
    const res = await create(programme(5, { name: pair('   ', 'x'.repeat(81)), linkLabel: pair('फक्त मराठी', '') }));
    expect(res.status).toBe(422);
    expect(details(res)).toEqual(
      expect.arrayContaining([
        { field: 'body.name.mr', message: 'Programme name (Marathi) is required' },
        { field: 'body.name.en', message: 'Programme name (English) must be at most 80 characters' },
        { field: 'body.linkLabel.en', message: 'Link label (English) is required when the Marathi text is filled in' },
      ]),
    );
  });

  it.each(['<svg onload=alert(1)>', 'chevR', 'Award', 'dashboard', ''])('refuses the icon %j', async (icon) => {
    const res = await create(programme(6, { icon }));
    expect(res.status).toBe(422);
    expect(details(res)).toEqual([{ field: 'body.icon', message: 'Choose one of the listed icons' }]);
  });

  it.each([
    ['javascript:alert(1)', 'Destination must be a page on this site starting with /, or a web address starting with https:// or www.'],
    ['data:text/html,hi', 'Destination must be a page on this site starting with /, or a web address starting with https:// or www.'],
    ['//evil.example.com', 'A page on this site must start with a single / and use only letters, digits and - _ . ~ / ? = & % #'],
    ['/apply"><script>', 'A page on this site must start with a single / and use only letters, digits and - _ . ~ / ? = & % #'],
    ['programme', 'Destination must be a page on this site starting with /, or a web address starting with https:// or www.'],
    ['ftp://example.gov.in', 'Destination must be a page on this site starting with /, or a web address starting with https:// or www.'],
    ['https://user:pw@example.gov.in', 'The address must not contain a user name or password'],
    ['https://localhost/x', 'Enter a full address, e.g. https://example.gov.in'],
    ['https://exa mple.gov.in', 'The address contains characters that are not allowed'],
  ])('refuses the destination %j', async (link, message) => {
    const res = await create(programme(7, { link }));
    expect(res.status).toBe(422);
    expect(details(res)).toEqual([{ field: 'body.link', message }]);
  });

  it('answers 422 for a malformed id and 404 for an unknown one', async () => {
    expect((await request(app).get(`${ADMIN_URL}/nope`).set(auth(admin.token))).status).toBe(422);
    const unknown = '00000000-0000-4000-8000-000000000000';
    expect((await request(app).get(`${ADMIN_URL}/${unknown}`).set(auth(admin.token))).status).toBe(404);
    expect((await patch(unknown, { icon: 'award' })).status).toBe(404);
    expect((await request(app).delete(`${ADMIN_URL}/${unknown}`).set(auth(admin.token))).status).toBe(404);
  });
});

describe('Editing a programme', () => {
  let p: AdminProgramme;
  beforeAll(async () => {
    p = (await create(programme(10, { link: '/faq' })).expect(201)).body.data;
  });

  it('changes only the fields sent', async () => {
    const res = await patch(p.id, { icon: 'chart' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: p.name, description: p.description, link: '/faq', icon: 'chart', displayOrder: p.displayOrder });
    p = res.body.data;
  });

  it('updates name, description, icon and destination together, and can clear the destination', async () => {
    const res = await patch(p.id, {
      name: pair('सुधारित चाचणी', 'Updated test'),
      description: pair('सुधारित वर्णन', 'Updated description'),
      icon: 'shield',
      link: 'https://example.gov.in/updated',
      expectedUpdatedAt: p.updatedAt,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: pair('सुधारित चाचणी', 'Updated test'), icon: 'shield', link: 'https://example.gov.in/updated' });
    expect((await patch(p.id, { link: null })).body.data.link).toBeNull();
    expect((await patch(p.id, { link: '' })).body.data.link).toBeNull();
    p = (await request(app).get(`${ADMIN_URL}/${p.id}`).set(auth(admin.token))).body.data;
  });

  it('refuses a save over a newer version, and changes nothing', async () => {
    const res = await patch(p.id, { icon: 'award', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' });
    expect(res.status).toBe(409);
    expect((await request(app).get(`${ADMIN_URL}/${p.id}`).set(auth(admin.token))).body.data).toEqual(p);
  });

  it('refuses renaming a card to another card’s name', async () => {
    expect((await patch(p.id, { name: pair('अमृत पेठ', 'Different') })).status).toBe(409);
  });

  it('keeps the saved card when the database save fails', async () => {
    jest.spyOn(auditService, 'recordInTx').mockRejectedValueOnce(new Error('simulated database failure'));
    const res = await patch(p.id, { name: pair('टिकू नये', 'Must not stick') });
    expect(res.status).toBe(500);
    expect((await request(app).get(`${ADMIN_URL}/${p.id}`).set(auth(admin.token))).body.data).toEqual(p);
  });

  it('a hidden card leaves the website and comes back when shown', async () => {
    await request(app).patch(`${ADMIN_URL}/${p.id}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);
    expect((await publicCards()).map((c) => c.id)).not.toContain(p.id);
    await request(app).patch(`${ADMIN_URL}/${p.id}/status`).set(auth(admin.token)).send({ isActive: true }).expect(200);
    expect((await publicCards()).map((c) => c.id)).toContain(p.id);
  });
});

describe('Deleting and ordering', () => {
  it('deletes only the chosen card: soft-deleted, gone from the website, the rest untouched', async () => {
    const p = (await create(programme(20)).expect(201)).body.data as AdminProgramme;
    const others = (await list()).filter((x) => x.id !== p.id);
    const res = await request(app).delete(`${ADMIN_URL}/${p.id}`).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Programme deleted successfully');
    expect(await list()).toEqual(others);
    expect((await publicCards()).map((c) => c.id)).not.toContain(p.id);
    const [row] = await AppDataSource.query(`SELECT "isDelete", "isActive" FROM "ecosystem_programmes" WHERE "id" = $1`, [p.id]);
    expect(row).toEqual({ isDelete: true, isActive: false });
    expect((await request(app).delete(`${ADMIN_URL}/${p.id}`).set(auth(admin.token))).status).toBe(404);
    /* The name is free again once the card is deleted. */
    expect((await create(programme(20))).status).toBe(201);
  });

  it('reorders by id and refuses a stale or duplicated list', async () => {
    const ids = (await list()).map((r) => r.id);
    const reversed = [...ids].reverse();
    const res = await request(app).put(`${ADMIN_URL}/order`).set(auth(admin.token)).send({ ids: reversed });
    expect(res.status).toBe(200);
    expect((res.body.data as AdminProgramme[]).map((r) => [r.id, r.displayOrder])).toEqual(reversed.map((id, i) => [id, i + 1]));
    expect((await publicCards()).map((c) => c.id)).toEqual(reversed);
    expect((await request(app).put(`${ADMIN_URL}/order`).set(auth(admin.token)).send({ ids: reversed.slice(1) })).status).toBe(409);
    expect((await request(app).put(`${ADMIN_URL}/order`).set(auth(admin.token)).send({ ids: [ids[0], ids[0]] })).status).toBe(422);
  });
});

describe('Section settings', () => {
  const put = (payload: unknown) => request(app).put(`${ADMIN_URL}/settings`).set(auth(admin.token)).send(payload as object);

  it('updates heading, subtitle and default label, and can hide the section', async () => {
    const current = (await request(app).get(`${ADMIN_URL}/settings`).set(auth(admin.token)).expect(200)).body.data;
    const res = await put({
      heading: pair('नवीन शीर्षक', 'New heading'),
      subtitle: BLANK,
      linkLabel: pair('पुढे वाचा →', 'Read on →'),
      showSection: true,
      expectedUpdatedAt: current.updatedAt,
    });
    expect(res.status).toBe(200);
    const pub = (await request(app).get(PUBLIC_URL)).body.data;
    expect(pub).toMatchObject({ heading: pair('नवीन शीर्षक', 'New heading'), subtitle: null, showSection: true });
    const own = (pub.programmes as { linkLabel: Pair }[]).filter((c) => c.linkLabel.en === 'Visit').length;
    expect((pub.programmes as { linkLabel: Pair }[]).filter((c) => c.linkLabel.en === 'Read on →')).toHaveLength(pub.programmes.length - own);

    await put({ heading: pair('अ', 'A'), subtitle: BLANK, linkLabel: DEFAULT_LABEL, showSection: false }).expect(200);
    expect((await request(app).get(PUBLIC_URL)).body.data).toMatchObject({ showSection: false, programmes: [] });
  });

  it('requires the heading and default label, and refuses stale saves', async () => {
    const res = await put({ heading: BLANK, subtitle: pair('फक्त', ''), linkLabel: BLANK, showSection: true });
    expect(res.status).toBe(422);
    expect(details(res).map((d) => d.field).sort()).toEqual([
      'body.heading.en',
      'body.heading.mr',
      'body.linkLabel.en',
      'body.linkLabel.mr',
      'body.subtitle.en',
    ]);
    const stale = await put({ heading: pair('अ', 'A'), subtitle: BLANK, linkLabel: DEFAULT_LABEL, showSection: true, expectedUpdatedAt: '2020-01-01T00:00:00.000Z' });
    expect(stale.status).toBe(409);
  });
});

describe('Access control', () => {
  it('refuses every admin route without a session', async () => {
    expect((await request(app).get(ADMIN_URL)).status).toBe(401);
    expect((await request(app).post(ADMIN_URL).send(programme(30))).status).toBe(401);
    expect((await request(app).put(`${ADMIN_URL}/settings`).send({})).status).toBe(401);
  });

  it('a view-only administrator can read but not create, edit, reorder, change settings or delete', async () => {
    const viewer = await actorWith(['cms-ecosystem.view']);
    const [first] = await list();
    const V = auth(viewer.token);
    expect((await request(app).get(ADMIN_URL).set(V)).status).toBe(200);
    expect((await create(programme(31), viewer.token)).status).toBe(403);
    expect((await request(app).patch(`${ADMIN_URL}/${first!.id}`).set(V).send({ icon: 'award' })).status).toBe(403);
    expect((await request(app).put(`${ADMIN_URL}/order`).set(V).send({ ids: [first!.id] })).status).toBe(403);
    expect((await request(app).put(`${ADMIN_URL}/settings`).set(V).send({})).status).toBe(403);
    expect((await request(app).delete(`${ADMIN_URL}/${first!.id}`).set(V)).status).toBe(403);
  });

  it('another CMS permission does not open this section', async () => {
    const other = await actorWith(['cms-board.view', 'cms-board.update']);
    expect((await request(app).get(ADMIN_URL).set(auth(other.token))).status).toBe(403);
  });
});
