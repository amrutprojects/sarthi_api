import type { Express } from 'express';
import { Repository, type ObjectLiteral } from 'typeorm';
import { AppDataSource, API, actorWith, auth, request, setupTestApp, superAdmin, teardownTestApp, type TestActor } from '../../helpers/test-app';
import { seedContactPage } from '../../../src/database/seeds/seed-contact-page';
import { seedContactDirectory } from '../../../src/database/seeds/seed-contact-directory';
import { ContactDistrictOffice, ContactOrganization, ContactPageSettings } from '../../../src/cms/contact/contact.model';
import { District } from '../../../src/cms/masters/district/district.model';
import { State } from '../../../src/cms/masters/state/state.model';

const ADMIN_URL = `${API}/cms/contact`;
const PUBLIC_URL = `${API}/public/contact`;

let app: Express;
let admin: TestActor;

type Pair = { mr: string; en: string };

/* The request body as the admin screen sends it. Written out so tests can vary one field at a time. */
interface OrgPayload {
  orgType: string;
  name: Pair;
  role?: Pair;
  address?: Pair;
  email?: string;
  phone?: string;
  websiteUrl?: string;
  helpdeskHours?: Pair;
  displayOrder?: number;
  isActive?: boolean;
}

interface PagePayload {
  pageTitle: Pair;
  pageSubtitle: Pair;
  isPublished?: boolean;
  organizations: OrgPayload[];
}

/* The shape the admin screen submits: the banner plus both cards. */
const validPayload = (): PagePayload => ({
  pageTitle: { mr: 'संपर्क', en: 'Contact' },
  pageSubtitle: { mr: 'संपर्क माहिती', en: 'Contact Information' },
  isPublished: true,
  organizations: [
    {
      orgType: 'AMRUT',
      name: { mr: 'AMRUT', en: 'AMRUT' },
      address: { mr: 'पुणे पत्ता', en: 'Pune address' },
      email: 'info@mahaamrut.org.in',
      phone: '+91 97301 51450',
      websiteUrl: 'https://mahaamrut.org.in/',
      displayOrder: 0,
    },
    {
      orgType: 'IMPLEMENTATION_PARTNER',
      name: { mr: 'SUMAGO INFOTECH PVT LTD', en: 'SUMAGO INFOTECH PVT LTD' },
      role: { mr: 'भागीदार', en: 'Implementation & technology partner' },
      email: 'programme@sumago.demo',
      helpdeskHours: { mr: 'सोम–शनि', en: 'Mon–Sat, 10:00 – 18:00' },
      displayOrder: 1,
    },
  ],
});

/* resetData() truncates the contact tables, so each file re-seeds the singleton it edits. */
beforeAll(async () => {
  app = await setupTestApp();
  await seedContactPage(AppDataSource);
  admin = await superAdmin();
});
afterAll(teardownTestApp);

describe('Contact page seed', () => {
  it('seeds the page and both cards with the values the site used to hardcode', async () => {
    const res = await request(app).get(ADMIN_URL).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      pageTitle: { mr: 'संपर्क', en: 'Contact' },
      pageSubtitle: { mr: 'संपर्क माहिती', en: 'Contact Information' },
      isPublished: true,
    });

    const types = res.body.data.organizations.map((o: { orgType: string }) => o.orgType);
    expect(types).toEqual(['AMRUT', 'IMPLEMENTATION_PARTNER']);

    const amrut = res.body.data.organizations[0];
    expect(amrut).toMatchObject({
      email: 'info@mahaamrut.org.in',
      phone: '+91 97301 51450',
      websiteUrl: 'https://mahaamrut.org.in/',
    });
    expect(amrut.address.en).toMatch(/AMRUT Building/);
    expect(amrut.address.mr).toMatch(/अमृत/);

    const partner = res.body.data.organizations[1];
    expect(partner.role.en).toBe('Implementation & technology partner');
    expect(partner.helpdeskHours.en).toMatch(/Mon–Sat/);
  });

  it('never overwrites administrator edits on a later run', async () => {
    await request(app)
      .put(ADMIN_URL)
      .set(auth(admin.token))
      .send({ ...validPayload(), pageTitle: { mr: 'नवीन शीर्षक', en: 'Edited title' } })
      .expect(200);

    const summary = await seedContactPage(AppDataSource);
    expect(summary).toEqual({ created: false, organizationsCreated: 0 });

    const after = await request(app).get(ADMIN_URL).set(auth(admin.token));
    expect(after.body.data.pageTitle.en).toBe('Edited title');
  });

  it('refuses a second settings row at the database level', async () => {
    const repo = AppDataSource.getRepository(ContactPageSettings);
    await expect(
      repo.insert({
        pageTitleMr: 'दुसरे', pageTitleEn: 'Second',
        pageSubtitleMr: 'उप', pageSubtitleEn: 'Sub',
        isPublished: true,
      }),
    ).rejects.toThrow();
  });
});

describe('Contact page update', () => {
  it('saves the banner and both cards, in both languages', async () => {
    const payload = validPayload();
    payload.pageTitle = { mr: 'संपर्क करा', en: 'Contact us' };
    payload.organizations[0].phone = '+91 20 1234 5678';

    const res = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(payload);
    expect(res.status).toBe(200);
    expect(res.body.data.pageTitle).toEqual({ mr: 'संपर्क करा', en: 'Contact us' });
    expect(res.body.data.organizations[0].phone).toBe('+91 20 1234 5678');

    /* Round-trips through the database, not just echoed back. */
    const reread = await request(app).get(ADMIN_URL).set(auth(admin.token));
    expect(reread.body.data.pageTitle.mr).toBe('संपर्क करा');
  });

  it('lower-cases the email and keeps Marathi text intact', async () => {
    const payload = validPayload();
    payload.organizations[0].email = 'INFO@MahaAmrut.ORG.in';
    const res = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(payload);
    expect(res.status).toBe(200);
    expect(res.body.data.organizations[0].email).toBe('info@mahaamrut.org.in');
    expect(res.body.data.organizations[0].address.mr).toBe('पुणे पत्ता');
  });

  it('rejects a half-translated field (422)', async () => {
    const payload = validPayload() as unknown as { pageTitle: { mr: string; en?: string } };
    delete payload.pageTitle.en;
    const res = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(payload);
    expect(res.status).toBe(422);
  });

  it('enforces the fields each card type requires (422)', async () => {
    const noAddress = validPayload();
    delete (noAddress.organizations[0] as { address?: unknown }).address;
    const a = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(noAddress);
    expect(a.status).toBe(422);
    expect(JSON.stringify(a.body)).toMatch(/Address is required for the AMRUT card/);

    const noHours = validPayload();
    delete (noHours.organizations[1] as { helpdeskHours?: unknown }).helpdeskHours;
    const b = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(noHours);
    expect(b.status).toBe(422);
    expect(JSON.stringify(b.body)).toMatch(/Helpdesk hours are required/);
  });

  it('rejects a malformed email, phone and website URL (422)', async () => {
    const cases: [string, unknown][] = [
      ['email', 'not-an-email'],
      ['phone', 'call me maybe'],
      ['phone', '12345'],
      ['websiteUrl', 'javascript:alert(1)'],
      ['websiteUrl', 'mahaamrut.org.in'],
    ];
    for (const [field, value] of cases) {
      const payload = validPayload();
      (payload.organizations[0] as unknown as Record<string, unknown>)[field] = value;
      const res = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(payload);
      expect([422, 400]).toContain(res.status);
    }
  });

  it('rejects unknown fields and a duplicate card type', async () => {
    const extra = { ...validPayload(), somethingElse: 1 };
    expect((await request(app).put(ADMIN_URL).set(auth(admin.token)).send(extra)).status).toBe(422);

    const dup = validPayload();
    dup.organizations.push({ ...dup.organizations[0] });
    const res = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(dup);
    expect([400, 422]).toContain(res.status);
  });

  it('is transactional: a rejected payload changes nothing', async () => {
    const before = await request(app).get(ADMIN_URL).set(auth(admin.token));

    const broken = validPayload();
    broken.pageTitle = { mr: 'अर्धवट', en: 'Half saved' };
    broken.organizations[0].email = 'not-an-email';
    await request(app).put(ADMIN_URL).set(auth(admin.token)).send(broken);

    const after = await request(app).get(ADMIN_URL).set(auth(admin.token));
    expect(after.body.data.pageTitle).toEqual(before.body.data.pageTitle);
  });

  it('writes an audit entry for the change', async () => {
    await request(app).put(ADMIN_URL).set(auth(admin.token)).send(validPayload()).expect(200);
    const logs = await request(app).get(`${API}/audit-logs`).query({ limit: 20 }).set(auth(admin.token));
    const actions = logs.body.data.map((l: { action: string }) => l.action);
    expect(actions).toContain('cms.contact-page.update');
  });
});

describe('Contact page publication', () => {
  afterEach(async () => {
    await request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ isPublished: true });
  });

  it('publishes and unpublishes', async () => {
    const off = await request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ isPublished: false });
    expect(off.status).toBe(200);
    expect(off.body.data.isPublished).toBe(false);
  });

  it('hides the content from the public endpoint while unpublished', async () => {
    await request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ isPublished: false }).expect(200);

    const hidden = await request(app).get(PUBLIC_URL);
    expect(hidden.status).toBe(200);
    expect(hidden.body.data).toBeNull();

    await request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ isPublished: true }).expect(200);
    const shown = await request(app).get(PUBLIC_URL);
    expect(shown.body.data).not.toBeNull();
  });

  it('rejects a non-boolean status (422)', async () => {
    expect((await request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ isPublished: 'yes' })).status).toBe(422);
  });
});

describe('public Contact endpoint', () => {
  it('serves the page without a session, in both languages', async () => {
    const res = await request(app).get(PUBLIC_URL);
    expect(res.status).toBe(200);
    expect(res.body.data.pageTitle).toHaveProperty('mr');
    expect(res.body.data.pageTitle).toHaveProperty('en');
    expect(res.body.data.organizations.length).toBe(2);
  });

  it('exposes only the words on the page — no ids, timestamps or flags', async () => {
    const res = await request(app).get(PUBLIC_URL);
    const serialised = JSON.stringify(res.body.data);
    for (const leaked of ['"id"', 'isActive', 'isDelete', 'isPublished', 'createdAt', 'updatedAt', 'displayOrder', 'settingsId']) {
      expect(serialised).not.toContain(leaked);
    }
  });

  it('omits inactive cards', async () => {
    const payload = validPayload();
    payload.organizations[1].isActive = false;
    await request(app).put(ADMIN_URL).set(auth(admin.token)).send(payload).expect(200);

    const res = await request(app).get(PUBLIC_URL);
    expect(res.body.data.organizations.map((o: { orgType: string }) => o.orgType)).toEqual(['AMRUT']);

    /* The admin still sees it — only the public view filters. */
    const adminView = await request(app).get(ADMIN_URL).set(auth(admin.token));
    expect(adminView.body.data.organizations.length).toBe(2);

    await request(app).put(ADMIN_URL).set(auth(admin.token)).send(validPayload()).expect(200);
  });

  it('offers no write path', async () => {
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await request(app)[method](PUBLIC_URL).send(validPayload());
      expect(res.status).toBe(404);
    }
  });
});

describe('Contact page authorisation', () => {
  it('needs a session', async () => {
    expect((await request(app).get(ADMIN_URL)).status).toBe(401);
    expect((await request(app).put(ADMIN_URL).send(validPayload())).status).toBe(401);
    expect((await request(app).patch(`${ADMIN_URL}/status`).send({ isPublished: false })).status).toBe(401);
  });

  it('a view-only actor can read but not write (403)', async () => {
    const viewer = await actorWith(['cms-contact.view']);
    expect((await request(app).get(ADMIN_URL).set(auth(viewer.token))).status).toBe(200);
    expect((await request(app).put(ADMIN_URL).set(auth(viewer.token)).send(validPayload())).status).toBe(403);
    expect((await request(app).patch(`${ADMIN_URL}/status`).set(auth(viewer.token)).send({ isPublished: false })).status).toBe(403);
  });

  it('an actor without the CMS codes cannot even read (403)', async () => {
    const outsider = await actorWith(['users.view']);
    expect((await request(app).get(ADMIN_URL).set(auth(outsider.token))).status).toBe(403);
  });

  it('keeps a card for every type after the round trip', async () => {
    const rows = await AppDataSource.getRepository(ContactOrganization).find({ where: { isDelete: false } });
    expect(rows.map((r) => r.orgType).sort()).toEqual(['AMRUT', 'IMPLEMENTATION_PARTNER']);
  });
});

describe('Contact page coordinators and district offices', () => {
  const districts: Record<string, string> = {};

  const create = async (path: string, body: object): Promise<string> => {
    const res = await request(app).post(`${API}${path}`).set(auth(admin.token)).send(body);
    if (res.status !== 201) throw new Error(`POST ${path} failed (${res.status}): ${JSON.stringify(res.body)}`);
    return res.body.data.id as string;
  };

  beforeAll(async () => {
    const stateId = await create('/cms/states', { name: 'Contact Test State', code: 'CTS' });
    districts.pune = await create('/cms/districts', { stateId, name: 'Pune', code: 'PUN' });
    districts.nashik = await create('/cms/districts', { stateId, name: 'Nashik', code: 'NSK' });
  });

  const put = (body: object) => request(app).put(ADMIN_URL).set(auth(admin.token)).send(body);

  it('saves coordinators with their districts and serves them publicly', async () => {
    const res = await put({
      ...validPayload(),
      coordinators: [{ name: 'Rajesh Kulkarni', phone: '+91 98000 41201', email: 'DC.West@Sumago.demo', districtIds: [districts.pune] }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.coordinators).toHaveLength(1);
    expect(res.body.data.coordinators[0].email).toBe('dc.west@sumago.demo');
    expect(res.body.data.coordinators[0].districts).toEqual([{ id: districts.pune, name: 'Pune', code: 'PUN' }]);

    const pub = await request(app).get(PUBLIC_URL);
    expect(pub.body.data.coordinators).toEqual([
      { name: 'Rajesh Kulkarni', phone: '+91 98000 41201', email: 'dc.west@sumago.demo', districts: [{ code: 'PUN', name: 'Pune' }] },
    ]);
  });

  it('rejects a district assigned to two coordinators', async () => {
    const res = await put({
      ...validPayload(),
      coordinators: [
        { name: 'A', phone: '+91 98000 00001', districtIds: [districts.pune] },
        { name: 'B', phone: '+91 98000 00002', districtIds: [districts.pune] },
      ],
    });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown district', async () => {
    const res = await put({
      ...validPayload(),
      districtOffices: [{ districtId: '00000000-0000-4000-8000-000000000000', collectorName: 'X' }],
    });
    expect(res.status).toBe(400);
  });

  it('saves partial district office details and omits the blanks publicly', async () => {
    const res = await put({
      ...validPayload(),
      districtOffices: [{ districtId: districts.nashik, collectorName: 'Collector Nashik', officeHours: { mr: 'सोम–शुक्र', en: 'Mon–Fri' } }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.districtOffices[0]).toMatchObject({ collectorName: 'Collector Nashik', address: null, phone: null });

    const pub = await request(app).get(PUBLIC_URL);
    expect(pub.body.data.districtOffices).toEqual([
      { district: { code: 'NSK', name: 'Nashik' }, collectorName: 'Collector Nashik', officeHours: { mr: 'सोम–शुक्र', en: 'Mon–Fri' } },
    ]);
  });

  it('leaves both sections untouched when a payload omits them', async () => {
    const res = await put(validPayload());
    expect(res.status).toBe(200);
    expect(res.body.data.coordinators).toHaveLength(1);
    expect(res.body.data.districtOffices).toHaveLength(1);
  });

  it('hides inactive entries from the public endpoint and clears lists sent empty', async () => {
    await put({
      ...validPayload(),
      coordinators: [{ name: 'Hidden', phone: '+91 98000 00003', districtIds: [districts.nashik], isActive: false }],
      districtOffices: [{ districtId: districts.pune, collectorName: 'Hidden Collector', isActive: false }],
    });
    const pub = await request(app).get(PUBLIC_URL);
    expect(pub.body.data.coordinators).toEqual([]);
    expect(pub.body.data.districtOffices).toEqual([]);

    const cleared = await put({ ...validPayload(), coordinators: [], districtOffices: [] });
    expect(cleared.body.data.coordinators).toEqual([]);
    expect(cleared.body.data.districtOffices).toEqual([]);
  });
});

/*
 * seedContactDirectory moves the website's bundled coordinators and districts
 * (public-site/data/demo-data.ts) into the database "as it is". The constants below are copied from
 * that file on purpose: the test pins the seed to what the site showed, not to the seed's own data.
 */
describe('Contact directory seed (coordinators and district offices)', () => {
  /* demo-data.ts `D`: [name, code], in the site's order. */
  const SITE_DISTRICTS: [string, string][] = [
    ['Nandurbar', 'NDB'], ['Dhule', 'DHU'], ['Jalgaon', 'JAL'], ['Buldhana', 'BUL'], ['Akola', 'AKO'], ['Amravati', 'AMR'],
    ['Nagpur', 'NAG'], ['Bhandara', 'BHA'], ['Gondia', 'GON'], ['Palghar', 'PAL'], ['Nashik', 'NAS'], ['Washim', 'WAS'],
    ['Yavatmal', 'YAV'], ['Wardha', 'WAR'], ['Chandrapur', 'CHA'], ['Gadchiroli', 'GAD'], ['Mumbai Suburban', 'MUS'], ['Thane', 'THA'],
    ['Chhatrapati Sambhajinagar', 'CSN'], ['Jalna', 'JLN'], ['Hingoli', 'HIN'], ['Parbhani', 'PAR'], ['Nanded', 'NAN'], ['Mumbai City', 'MUC'],
    ['Raigad', 'RAI'], ['Pune', 'PUN'], ['Ahilyanagar', 'AHL'], ['Beed', 'BEE'], ['Latur', 'LAT'], ['Dharashiv', 'DHA'],
    ['Ratnagiri', 'RAT'], ['Satara', 'SAT'], ['Solapur', 'SOL'], ['Sindhudurg', 'SIN'], ['Kolhapur', 'KOL'], ['Sangli', 'SAN'],
  ];

  /* demo-data.ts `coordinators`, phones masked exactly as the site prints them. */
  const SITE_COORDINATORS = [
    { name: 'Rajesh Kulkarni', phone: '+91 98XXX 41201', email: 'dc.west@sumago.demo', districts: ['PUN', 'SAT', 'KOL', 'SAN', 'SOL', 'RAT', 'SIN'] },
    { name: 'Sneha Deshmukh', phone: '+91 98XXX 41202', email: 'dc.north@sumago.demo', districts: ['NAS', 'AHL', 'JAL', 'DHU', 'NDB', 'PAL'] },
    { name: 'Amit Jadhav', phone: '+91 98XXX 41203', email: 'dc.konkan@sumago.demo', districts: ['THA', 'MUC', 'MUS', 'RAI'] },
    { name: 'Priya Shinde', phone: '+91 98XXX 41204', email: 'dc.marathwada@sumago.demo', districts: ['CSN', 'BEE', 'JLN', 'LAT', 'DHA', 'PAR', 'HIN', 'NAN'] },
    { name: 'Vikas Thorat', phone: '+91 98XXX 41205', email: 'dc.vidarbha@sumago.demo', districts: ['NAG', 'AMR', 'AKO', 'BUL', 'WAS', 'YAV', 'WAR', 'BHA', 'GON', 'GAD', 'CHA'] },
  ];

  const NOTHING_SEEDED = { stateCreated: false, districtsCreated: 0, districtsSkipped: [], coordinatorsCreated: 0, districtOfficesCreated: 0 };

  interface Ref { id: string; name: string; code: string }
  interface AdminPage {
    id: string;
    pageTitle: Pair;
    pageSubtitle: Pair;
    isPublished: boolean;
    organizations: (Omit<OrgPayload, 'role' | 'address' | 'helpdeskHours'> & { id: string; role: Pair | null; address: Pair | null; helpdeskHours: Pair | null })[];
    coordinators: { id: string; name: string; phone: string; email: string | null; districts: Ref[]; displayOrder: number; isActive: boolean }[];
    districtOffices: {
      id: string; district: Ref; collectorName: string | null; address: Pair | null; phone: string | null; email: string | null;
      officeHours: Pair | null; isActive: boolean;
    }[];
  }
  interface PublicCoordinator { name: string; phone: string; email?: string; districts: { code: string; name: string }[] }

  const put = (body: object) => request(app).put(ADMIN_URL).set(auth(admin.token)).send(body);
  const adminPage = async (): Promise<AdminPage> => (await request(app).get(ADMIN_URL).set(auth(admin.token)).expect(200)).body.data;
  const publicPage = async () => (await request(app).get(PUBLIC_URL).expect(200)).body.data;

  /*
   * Order-independent: earlier blocks in this file leave coordinator and office rows (live or
   * soft-deleted) behind, which would rightly make the seed do nothing. Each test starts as a database
   * on which these two sections have never been used and no Maharashtra state exists yet.
   */
  const resetDirectory = async () => {
    await AppDataSource.query(`DELETE FROM "contact_coordinator_districts"`);
    await AppDataSource.query(`DELETE FROM "contact_coordinators"`);
    await AppDataSource.query(`DELETE FROM "contact_district_offices"`);
    const mh = `SELECT "id" FROM "states" WHERE "code" = 'MH' OR lower("name") = 'maharashtra'`;
    await AppDataSource.query(`DELETE FROM "districts" WHERE "stateId" IN (${mh})`);
    await AppDataSource.query(`DELETE FROM "states" WHERE "id" IN (${mh})`);
  };

  beforeEach(async () => {
    await resetDirectory();
    await request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ isPublished: true }).expect(200);
  });
  afterAll(resetDirectory);

  const counts = async () => {
    const [row] = await AppDataSource.query(`
      SELECT
        (SELECT count(*) FROM "states" WHERE "code" = 'MH')::int AS states,
        (SELECT count(*) FROM "districts" d JOIN "states" s ON s."id" = d."stateId" WHERE s."code" = 'MH')::int AS districts,
        (SELECT count(*) FROM "contact_coordinators")::int AS coordinators,
        (SELECT count(*) FROM "contact_coordinator_districts")::int AS links,
        (SELECT count(*) FROM "contact_district_offices")::int AS offices`);
    return row as Record<string, number>;
  };

  const createState = (name: string, code: string, isDelete = false) =>
    AppDataSource.getRepository(State).save(AppDataSource.getRepository(State).create({ name, code, isDelete }));
  const createDistrict = (stateId: string, name: string, code: string, isDelete = false) =>
    AppDataSource.getRepository(District).save(AppDataSource.getRepository(District).create({ stateId, name, code, isDelete }));

  /* The body the admin screen sends back for what it loaded (mirrors toPayload in the admin app). */
  const toAdminPayload = (p: AdminPage) => ({
    pageTitle: p.pageTitle,
    pageSubtitle: p.pageSubtitle,
    isPublished: p.isPublished,
    organizations: p.organizations.map((o) => ({
      orgType: o.orgType, name: o.name, role: o.role, address: o.address, email: o.email, phone: o.phone,
      websiteUrl: o.websiteUrl, helpdeskHours: o.helpdeskHours, displayOrder: o.displayOrder, isActive: o.isActive,
    })),
    coordinators: p.coordinators.map((c, index) => ({
      name: c.name, phone: c.phone, email: c.email, districtIds: c.districts.map((d) => d.id), displayOrder: index, isActive: c.isActive,
    })),
    districtOffices: p.districtOffices.map((o) => ({
      districtId: o.district.id, collectorName: o.collectorName, address: o.address, phone: o.phone, email: o.email,
      officeHours: o.officeHours, isActive: o.isActive,
    })),
  });

  it('first run: the five website coordinators over all 36 districts, and an empty office per district', async () => {
    const summary = await seedContactDirectory(AppDataSource);
    expect(summary).toEqual({ stateCreated: true, districtsCreated: 36, districtsSkipped: [], coordinatorsCreated: 5, districtOfficesCreated: 36 });

    const pub = await publicPage();
    const coordinators = pub.coordinators as PublicCoordinator[];
    /* Same people, same masked phones, same emails, same districts, in the site's order. */
    expect(coordinators.map((c) => ({ ...c, districts: c.districts.map((d) => d.code).sort() }))).toEqual(
      SITE_COORDINATORS.map((c) => ({ ...c, districts: [...c.districts].sort() })),
    );
    const siteName = new Map(SITE_DISTRICTS.map(([name, code]) => [code, name]));
    const covered = coordinators.flatMap((c) => c.districts);
    expect(covered).toHaveLength(36);
    expect(new Set(covered.map((d) => d.code)).size).toBe(36);
    for (const d of covered) expect(d.name).toBe(siteName.get(d.code));

    /* An office per district with nothing filled in: the site still prints "to be supplied". */
    expect(pub.districtOffices).toHaveLength(36);
    for (const o of pub.districtOffices) expect(Object.keys(o)).toEqual(['district']);
    expect(pub.districtOffices.map((o: { district: { code: string } }) => o.district.code).sort()).toEqual(
      SITE_DISTRICTS.map(([, code]) => code).sort(),
    );

    const view = await adminPage();
    expect(view.coordinators.map((c) => c.displayOrder)).toEqual([0, 1, 2, 3, 4]);
    for (const o of view.districtOffices) {
      expect(o).toMatchObject({ collectorName: null, address: null, phone: null, email: null, officeHours: null, isActive: true });
    }
    expect(await counts()).toEqual({ states: 1, districts: 36, coordinators: 5, links: 36, offices: 36 });
  });

  it('a second run is a no-op', async () => {
    await seedContactDirectory(AppDataSource);
    const before = await counts();
    const pubBefore = await publicPage();

    expect(await seedContactDirectory(AppDataSource)).toEqual(NOTHING_SEEDED);
    expect(await counts()).toEqual(before);
    expect(await publicPage()).toEqual(pubBefore);
  });

  it('never refills a list an administrator emptied (soft-deleted rows count as "used")', async () => {
    await seedContactDirectory(AppDataSource);
    const cleared = await put({ ...validPayload(), coordinators: [], districtOffices: [] });
    expect(cleared.status).toBe(200);

    expect(await seedContactDirectory(AppDataSource)).toEqual(NOTHING_SEEDED);

    const view = await adminPage();
    expect(view.coordinators).toEqual([]);
    expect(view.districtOffices).toEqual([]);
    /* The rows still exist, retired — that is what the seed's "never had a row" check sees. */
    const [retired] = await AppDataSource.query(`
      SELECT (SELECT count(*) FROM "contact_coordinators" WHERE "isDelete")::int AS coordinators,
             (SELECT count(*) FROM "contact_district_offices" WHERE "isDelete")::int AS offices`);
    expect(retired).toEqual({ coordinators: 5, offices: 36 });
  });

  it('keeps an administrator edit and seeds only the section never used', async () => {
    /* An admin set up Maharashtra / Pune and one coordinator before the seed ever ran. */
    const state = await createState('Maharashtra', 'MH');
    const pune = await createDistrict(state.id, 'Pune', 'PUN');
    await put({
      ...validPayload(),
      coordinators: [{ name: 'Admin Coordinator', phone: '+91 98000 00009', districtIds: [pune.id] }],
    }).expect(200);

    const summary = await seedContactDirectory(AppDataSource);
    expect(summary).toEqual({ stateCreated: false, districtsCreated: 35, districtsSkipped: [], coordinatorsCreated: 0, districtOfficesCreated: 36 });

    const view = await adminPage();
    expect(view.coordinators.map((c) => c.name)).toEqual(['Admin Coordinator']);
    expect(view.coordinators[0].districts).toEqual([{ id: pune.id, name: 'Pune', code: 'PUN' }]);
    expect(view.districtOffices).toHaveLength(36);
    expect(view.districtOffices.find((o) => o.district.code === 'PUN')?.district.id).toBe(pune.id);
  });

  it('reuses an existing district of the same name (any case) under its own code instead of duplicating it', async () => {
    /* As on the local database: Nashik was created by hand with code "NA", not the site's "NAS". */
    const state = await createState('Maharashtra', 'MH');
    const nashik = await createDistrict(state.id, 'Nashik', 'NA');
    const pune = await createDistrict(state.id, 'pune', 'PU');

    const summary = await seedContactDirectory(AppDataSource);
    expect(summary).toEqual({ stateCreated: false, districtsCreated: 34, districtsSkipped: [], coordinatorsCreated: 5, districtOfficesCreated: 36 });

    const named = await AppDataSource.query(
      `SELECT "id", "code" FROM "districts" WHERE "stateId" = $1 AND lower("name") IN ('nashik', 'pune') ORDER BY "code"`,
      [state.id],
    );
    expect(named).toEqual([{ id: nashik.id, code: 'NA' }, { id: pune.id, code: 'PU' }]);
    expect((await counts()).districts).toBe(36);

    const pub = await publicPage();
    const sneha = (pub.coordinators as PublicCoordinator[]).find((c) => c.name === 'Sneha Deshmukh')!;
    expect(sneha.districts).toContainEqual({ code: 'NA', name: 'Nashik' });
    expect(sneha.districts).toHaveLength(6);
    const codes = pub.districtOffices.map((o: { district: { code: string } }) => o.district.code);
    expect(codes).toContain('NA');
    expect(codes).not.toContain('NAS');
  });

  it('skips and reports a website district whose code another district already uses, without failing', async () => {
    const state = await createState('Maharashtra', 'MH');
    const road = await createDistrict(state.id, 'Nashik Road', 'NAS');

    const summary = await seedContactDirectory(AppDataSource);
    expect(summary).toEqual({
      stateCreated: false, districtsCreated: 35, districtsSkipped: ['Nashik (NAS)'], coordinatorsCreated: 5, districtOfficesCreated: 35,
    });

    /* The unrelated district is not borrowed for Nashik: no coordinator and no office point at it. */
    const [links] = await AppDataSource.query(
      `SELECT (SELECT count(*) FROM "contact_coordinator_districts" WHERE "districtId" = $1)::int AS links,
              (SELECT count(*) FROM "contact_district_offices" WHERE "districtId" = $1)::int AS offices`,
      [road.id],
    );
    expect(links).toEqual({ links: 0, offices: 0 });
    const sneha = ((await publicPage()).coordinators as PublicCoordinator[]).find((c) => c.name === 'Sneha Deshmukh')!;
    expect(sneha.districts.map((d) => d.code).sort()).toEqual(['AHL', 'DHU', 'JAL', 'NDB', 'PAL']);
  });

  it('uses a live state found by code MH under another name, and ignores a soft-deleted Maharashtra', async () => {
    const retired = await createState('Maharashtra', 'MH', true);
    const retiredPune = await createDistrict(retired.id, 'Pune', 'PUN', true);
    const live = await createState('State of Maharashtra', 'MH');

    const summary = await seedContactDirectory(AppDataSource);
    expect(summary.stateCreated).toBe(false);
    expect(summary.districtsCreated).toBe(36);

    const [{ n }] = await AppDataSource.query(`SELECT count(*)::int AS n FROM "districts" WHERE "stateId" = $1 AND NOT "isDelete"`, [live.id]);
    expect(n).toBe(36);
    const [untouched] = await AppDataSource.query(
      `SELECT (SELECT count(*) FROM "districts" WHERE "stateId" = $1)::int AS districts,
              (SELECT count(*) FROM "contact_coordinator_districts" WHERE "districtId" = $2)::int AS links`,
      [retired.id, retiredPune.id],
    );
    expect(untouched).toEqual({ districts: 1, links: 0 });
  });

  it('creates a fresh Maharashtra when only a soft-deleted one exists', async () => {
    await createState('Maharashtra', 'MH', true);
    const summary = await seedContactDirectory(AppDataSource);
    expect(summary).toMatchObject({ stateCreated: true, districtsCreated: 36, coordinatorsCreated: 5, districtOfficesCreated: 36 });
    const live = await AppDataSource.query(`SELECT "name" FROM "states" WHERE "code" = 'MH' AND NOT "isDelete"`);
    expect(live).toEqual([{ name: 'Maharashtra' }]);
  });

  it('does nothing at all while the Contact page settings row is missing', async () => {
    await AppDataSource.query(`UPDATE "contact_page_settings" SET "isDelete" = true WHERE NOT "isDelete"`);
    try {
      expect(await seedContactDirectory(AppDataSource)).toEqual(NOTHING_SEEDED);
      expect(await counts()).toEqual({ states: 0, districts: 0, coordinators: 0, links: 0, offices: 0 });
    } finally {
      await AppDataSource.query(
        `UPDATE "contact_page_settings" SET "isDelete" = false WHERE "id" = (SELECT "id" FROM "contact_page_settings" ORDER BY "createdAt" LIMIT 1)`,
      );
    }
  });

  it('is all-or-nothing: a failure on the last write leaves no state, district or coordinator behind', async () => {
    const insert = Repository.prototype.insert;
    const spy = jest
      .spyOn(Repository.prototype, 'insert')
      .mockImplementation(function (this: Repository<ObjectLiteral>, ...args: Parameters<typeof insert>) {
        if (this.metadata.target === ContactDistrictOffice) return Promise.reject(new Error('office insert failed'));
        return insert.apply(this, args);
      });
    try {
      await expect(seedContactDirectory(AppDataSource)).rejects.toThrow('office insert failed');
    } finally {
      spy.mockRestore();
    }
    expect(await counts()).toEqual({ states: 0, districts: 0, coordinators: 0, links: 0, offices: 0 });

    /* Nothing half-done blocks the next run. */
    expect((await seedContactDirectory(AppDataSource)).coordinatorsCreated).toBe(5);
  });

  it('round-trips through the admin screen unchanged: GET, convert, PUT back', async () => {
    await seedContactDirectory(AppDataSource);
    const before = await adminPage();
    const pubBefore = await publicPage();

    const res = await put(toAdminPayload(before));
    expect(res.status).toBe(200);

    /* Coordinators are re-created on save (new ids); everything else is updated in place. */
    const comparable = (p: AdminPage) => ({
      ...p, createdAt: undefined, updatedAt: undefined, coordinators: p.coordinators.map(({ id: _id, ...c }) => c),
    });
    expect(comparable(res.body.data)).toEqual(comparable(before));
    expect(comparable(await adminPage())).toEqual(comparable(before));
    expect(await publicPage()).toEqual(pubBefore);
  });

  it('accepts X only as a masked digit in a coordinator phone (422 otherwise)', async () => {
    const withPhone = (phone: string) => put({ ...validPayload(), coordinators: [{ name: 'Masked', phone }] });

    expect((await withPhone('+91 98XXX 41201')).status).toBe(200);
    for (const phone of ['+91 98ABC 41201', '+91 98YYY 41201', 'XXXXX', `+91 ${'X'.repeat(19)}`]) {
      expect({ phone, status: (await withPhone(phone)).status }).toEqual({ phone, status: 422 });
    }
  });

  it('still rejects X in an organisation phone and in a district office phone (422)', async () => {
    const org = validPayload();
    org.organizations[0].phone = '+91 97XXX 51450';
    expect((await put(org)).status).toBe(422);

    const office = await put({
      ...validPayload(),
      districtOffices: [{ districtId: '00000000-0000-4000-8000-000000000000', phone: '+91 20XXX 12345' }],
    });
    expect(office.status).toBe(422);
  });
});
