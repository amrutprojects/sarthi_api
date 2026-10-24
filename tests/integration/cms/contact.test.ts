import type { Express } from 'express';
import { Repository, type ObjectLiteral } from 'typeorm';
import {
  AppDataSource, API, actorWith, auth, createUser, login, request, setupTestApp, superAdmin, teardownTestApp, type TestActor,
} from '../../helpers/test-app';
import { MISSING_ID, makeDistrict, makeState } from '../../cms/helpers';
import { ROLE_CODES } from '../../../src/modules/roles-permissions/role.constants';
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
    coordinators: {
      id: string; name: string; phone: string; email: string | null; districts: Ref[]; displayOrder: number; isActive: boolean;
      createdAt: string; updatedAt: string;
    }[];
    districtOffices: {
      id: string; district: Ref; collectorName: string | null; address: Pair | null; phone: string | null; email: string | null;
      officeHours: Pair | null; isActive: boolean; createdAt: string; updatedAt: string;
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

    /* Coordinators are re-created on save (new ids); everything else is updated in place (new updatedAt). */
    const comparable = (p: AdminPage) => ({
      ...p, createdAt: undefined, updatedAt: undefined,
      coordinators: p.coordinators.map(({ id: _id, createdAt: _c, updatedAt: _u, ...c }) => c),
      districtOffices: p.districtOffices.map(({ createdAt: _c, updatedAt: _u, ...o }) => o),
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

/*
 * The coordinator and district office sections one entry at a time — what the admin's per-section
 * list, form and view pages use. Each block works on districts of a state of its own and starts every
 * test from two empty sections.
 */
const COORDINATORS_URL = `${ADMIN_URL}/coordinators`;
const OFFICES_URL = `${ADMIN_URL}/district-offices`;

interface ApiRef { id: string; name: string; code: string }
interface ApiCoordinator {
  id: string; name: string; phone: string; email: string | null; districts: ApiRef[]; displayOrder: number; isActive: boolean;
  createdAt: string; updatedAt: string;
}
interface ApiDistrictOffice {
  id: string; district: ApiRef; collectorName: string | null; address: Pair | null; phone: string | null; email: string | null;
  officeHours: Pair | null; isActive: boolean; createdAt: string; updatedAt: string;
}
type Listed = { body: { data: { id: string }[] } };

const clearSections = async () => {
  await AppDataSource.query(`DELETE FROM "contact_coordinator_districts"`);
  await AppDataSource.query(`DELETE FROM "contact_coordinators"`);
  await AppDataSource.query(`DELETE FROM "contact_district_offices"`);
};

/* A state and its districts, created through the API; the districts are returned by name. */
const sectionDistricts = async (stateName: string, stateCode: string, list: [string, string][]) => {
  const state = await makeState(app, admin.token, stateName, stateCode);
  const districts: Record<string, ApiRef> = {};
  for (const [name, code] of list) districts[name] = { id: (await makeDistrict(app, admin.token, state.id, name, code)).id, name, code };
  return { stateId: state.id, districts };
};

const idsOf = (res: Listed) => res.body.data.map((x) => x.id);
const adminView = async () => (await request(app).get(ADMIN_URL).set(auth(admin.token)).expect(200)).body.data;
const publicView = async () => (await request(app).get(PUBLIC_URL).expect(200)).body.data;
const publish = () => request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ isPublished: true }).expect(200);

describe('Contact coordinators, one card at a time', () => {
  let stateId: string;
  let d: Record<string, ApiRef>;

  const post = (body: object) => request(app).post(COORDINATORS_URL).set(auth(admin.token)).send(body);
  const patch = (id: string, body: object) => request(app).patch(`${COORDINATORS_URL}/${id}`).set(auth(admin.token)).send(body);
  const setStatus = (id: string, body: object) => request(app).patch(`${COORDINATORS_URL}/${id}/status`).set(auth(admin.token)).send(body);
  const get = (id: string) => request(app).get(`${COORDINATORS_URL}/${id}`).set(auth(admin.token));
  const remove = (id: string) => request(app).delete(`${COORDINATORS_URL}/${id}`).set(auth(admin.token));
  const list = (q: Record<string, string | number> = {}) => request(app).get(COORDINATORS_URL).query(q).set(auth(admin.token));
  const names = (res: { body: { data: ApiCoordinator[] } }) => res.body.data.map((c) => c.name);
  const make = async (body: object): Promise<ApiCoordinator> => {
    const res = await post(body);
    if (res.status !== 201) throw new Error(`POST coordinator failed (${res.status}): ${JSON.stringify(res.body)}`);
    return res.body.data;
  };

  beforeAll(async () => {
    ({ stateId, districts: d } = await sectionDistricts('Coordinator Test State', 'CRS', [
      ['Satara', 'SAT'], ['Sangli', 'SAN'], ['Kolhapur', 'KOL'], ['Solapur', 'SOL'], ['Ratnagiri', 'RAT'],
    ]));
    await publish();
  });
  beforeEach(clearSections);
  afterAll(clearSections);

  it('creates a card at the end of the list, its districts in the order given', async () => {
    const first = await post({ name: 'Asha Patil', phone: '+91 98XXX 10001', email: 'Asha.Patil@Sumago.demo', districtIds: [d.Sangli.id, d.Satara.id] });
    expect(first.status).toBe(201);
    expect(first.body.data).toEqual({
      id: expect.any(String), name: 'Asha Patil', phone: '+91 98XXX 10001', email: 'asha.patil@sumago.demo',
      districts: [d.Sangli, d.Satara], displayOrder: 0, isActive: true, createdAt: expect.any(String), updatedAt: expect.any(String),
    });

    expect(await make({ name: 'Bhushan Rao', phone: '+91 98000 10002', districtIds: [] })).toMatchObject({ email: null, districts: [], displayOrder: 1 });
    /* An explicit order and status are kept, and the next card still goes after it. */
    expect(await make({ name: 'Chitra Joshi', phone: '+91 98000 10003', displayOrder: 7, isActive: false })).toMatchObject({ displayOrder: 7, isActive: false });
    expect((await make({ name: 'Dinesh More', phone: '+91 98000 10004' })).displayOrder).toBe(8);
  });

  it('never assigns an order past the 999 the edit form accepts', async () => {
    await make({ name: 'Last', phone: '+91 98000 10005', displayOrder: 999 });
    expect((await make({ name: 'After last', phone: '+91 98000 10006' })).displayOrder).toBe(999);
  });

  it('gets one card (404 when missing, 422 for a malformed id)', async () => {
    const c = await make({ name: 'Asha Patil', phone: '+91 98000 20001', districtIds: [d.Kolhapur.id] });
    const res = await get(c.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(c);
    expect((await get(MISSING_ID)).status).toBe(404);
    expect((await get('not-a-uuid')).status).toBe(422);
  });

  it('lists a page at a time, in display order unless sorted otherwise', async () => {
    for (const [i, name] of ['Kiran', 'Anil', 'Meena'].entries()) await make({ name, phone: `+91 98000 3000${i}` });

    const first = await list({ limit: 2 });
    expect(first.status).toBe(200);
    expect(names(first)).toEqual(['Kiran', 'Anil']);
    expect(first.body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
    const second = await list({ limit: 2, page: 2 });
    expect(names(second)).toEqual(['Meena']);
    expect(second.body.meta).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });

    expect(names(await list({ sortBy: 'name' }))).toEqual(['Anil', 'Kiran', 'Meena']);
    expect(names(await list({ sortBy: 'name', sortOrder: 'desc' }))).toEqual(['Meena', 'Kiran', 'Anil']);
    expect(names(await list({ sortBy: 'createdAt', sortOrder: 'desc' }))).toEqual(['Meena', 'Anil', 'Kiran']);
    expect(names(await list({ sortBy: 'displayOrder', sortOrder: 'desc' }))).toEqual(['Meena', 'Anil', 'Kiran']);
    expect((await list({ sortBy: 'phone' })).status).toBe(422);
  });

  it('searches name, phone, email and the covered districts, ignoring case', async () => {
    const asha = await make({ name: 'Asha Patil', phone: '+91 98111 40001', email: 'west@sumago.demo', districtIds: [d.Kolhapur.id] });
    const bhushan = await make({ name: 'Bhushan Rao', phone: '+91 98222 40002', email: 'east@sumago.demo', districtIds: [d.Solapur.id] });
    const found = async (search: string) => idsOf(await list({ search }));

    expect(await found('asha')).toEqual([asha.id]);
    expect(await found('98222')).toEqual([bhushan.id]);
    expect(await found('WEST@')).toEqual([asha.id]);
    expect(await found('solapur')).toEqual([bhushan.id]);
    expect(await found('sumago')).toEqual([asha.id, bhushan.id]);
    expect(await found('nobody')).toEqual([]);
    /* LIKE wildcards are matched literally. */
    expect(await found('%')).toEqual([]);

    /* A page found through a district still carries every district of its cards. */
    const res = await list({ search: 'kolhapur' });
    expect(res.body.data[0].districts).toEqual([d.Kolhapur]);
    expect(res.body.meta).toMatchObject({ total: 1 });
  });

  it('lists inactive cards too, unless filtered by status', async () => {
    const on = await make({ name: 'Active One', phone: '+91 98000 50001' });
    const off = await make({ name: 'Inactive One', phone: '+91 98000 50002', isActive: false });
    expect(idsOf(await list())).toEqual([on.id, off.id]);
    expect(idsOf(await list({ isActive: 'true' }))).toEqual([on.id]);
    expect(idsOf(await list({ isActive: 'false' }))).toEqual([off.id]);
  });

  it('updates any subset of the fields and leaves the rest alone', async () => {
    const c = await make({ name: 'Asha Patil', phone: '+91 98000 60001', email: 'asha@sumago.demo', districtIds: [d.Satara.id] });

    const renamed = await patch(c.id, { name: 'Asha P. Patil' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toEqual({ ...c, name: 'Asha P. Patil', updatedAt: expect.any(String) });

    const cleared = await patch(c.id, { email: null, phone: '+91 98XXX 60001', displayOrder: 4, isActive: false });
    expect(cleared.body.data).toMatchObject({ email: null, phone: '+91 98XXX 60001', displayOrder: 4, isActive: false, districts: [d.Satara] });

    expect((await patch(c.id, {})).status).toBe(422);
    expect((await patch(c.id, { phone: 'call me maybe' })).status).toBe(422);
    expect((await patch(c.id, { somethingElse: 1 })).status).toBe(422);
    expect((await patch(MISSING_ID, { name: 'Nobody' })).status).toBe(404);
  });

  it('re-orders and replaces the districts when districtIds is sent', async () => {
    const c = await make({ name: 'Asha Patil', phone: '+91 98000 70001', districtIds: [d.Satara.id, d.Sangli.id, d.Kolhapur.id] });

    const reordered = await patch(c.id, { districtIds: [d.Kolhapur.id, d.Satara.id, d.Sangli.id] });
    expect(reordered.status).toBe(200);
    expect(reordered.body.data.districts).toEqual([d.Kolhapur, d.Satara, d.Sangli]);
    /* A districts-only edit still counts as an edit. */
    expect(new Date(reordered.body.data.updatedAt).getTime()).toBeGreaterThan(new Date(c.updatedAt).getTime());
    expect((await get(c.id)).body.data.districts).toEqual([d.Kolhapur, d.Satara, d.Sangli]);

    const replaced = await patch(c.id, { districtIds: [d.Solapur.id] });
    expect(replaced.body.data.districts).toEqual([d.Solapur]);
    /* The districts it gave up are free for another coordinator. */
    expect((await post({ name: 'Bhushan Rao', phone: '+91 98000 70002', districtIds: [d.Satara.id, d.Sangli.id] })).status).toBe(201);

    /* A repeated id is kept once, where it first appears; an empty list removes every district. */
    const repeated = await patch(c.id, { districtIds: [d.Ratnagiri.id, d.Solapur.id, d.Ratnagiri.id] });
    expect(repeated.body.data.districts).toEqual([d.Ratnagiri, d.Solapur]);
    expect((await patch(c.id, { districtIds: [] })).body.data.districts).toEqual([]);
    /* Other fields are untouched by a districts-only edit. */
    expect((await get(c.id)).body.data).toMatchObject({ name: 'Asha Patil', phone: '+91 98000 70001', displayOrder: 0 });
  });

  it('refuses a district another live coordinator covers (409), naming the district and the coordinator', async () => {
    const asha = await make({ name: 'Asha Patil', phone: '+91 98000 80001', districtIds: [d.Satara.id] });
    const bhushan = await make({ name: 'Bhushan Rao', phone: '+91 98000 80002', districtIds: [d.Sangli.id] });
    const clash = [{ field: 'districtIds', message: 'Satara is already covered by Asha Patil' }];

    const created = await post({ name: 'Chitra Joshi', phone: '+91 98000 80003', districtIds: [d.Kolhapur.id, d.Satara.id] });
    expect(created.status).toBe(409);
    expect(created.body.message).toBe('Satara is already covered by Asha Patil');
    expect(created.body.error).toMatchObject({ code: 'CONFLICT', details: clash });

    const moved = await patch(bhushan.id, { districtIds: [d.Sangli.id, d.Satara.id] });
    expect(moved.status).toBe(409);
    expect(moved.body.error.details).toEqual(clash);

    /* Nothing was written by either refusal, and a card's own districts are not a clash. */
    expect((await list()).body.meta.total).toBe(2);
    expect((await get(bhushan.id)).body.data.districts).toEqual([d.Sangli]);
    expect((await patch(asha.id, { districtIds: [d.Satara.id], name: 'Asha Patil' })).status).toBe(200);

    /* One detail per clashing district, in district-name order. */
    const both = await post({ name: 'Dinesh More', phone: '+91 98000 80004', districtIds: [d.Satara.id, d.Sangli.id] });
    expect(both.status).toBe(409);
    expect(both.body.error.details).toEqual([
      { field: 'districtIds', message: 'Sangli is already covered by Bhushan Rao' },
      { field: 'districtIds', message: 'Satara is already covered by Asha Patil' },
    ]);
  });

  it('rejects an unknown or deleted district (400)', async () => {
    const c = await make({ name: 'Asha Patil', phone: '+91 98000 90001' });
    const unknown = await post({ name: 'Bhushan Rao', phone: '+91 98000 90002', districtIds: [MISSING_ID] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.details).toEqual([{ field: 'districtIds', message: 'Unknown district' }]);

    const retired = await makeDistrict(app, admin.token, stateId, 'Retired District', 'RTD');
    await AppDataSource.query(`UPDATE "districts" SET "isDelete" = true WHERE "id" = $1`, [retired.id]);
    expect((await post({ name: 'Bhushan Rao', phone: '+91 98000 90002', districtIds: [retired.id] })).status).toBe(400);
    expect((await patch(c.id, { districtIds: [d.Satara.id, retired.id] })).status).toBe(400);
    expect((await get(c.id)).body.data.districts).toEqual([]);
    expect((await post({ name: 'Bad id', phone: '+91 98000 90003', districtIds: ['pune'] })).status).toBe(422);
  });

  it('activates and deactivates a card; the website shows active cards only', async () => {
    const c = await make({ name: 'Asha Patil', phone: '+91 98000 11001', districtIds: [d.Satara.id] });

    const off = await setStatus(c.id, { isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.data).toEqual({ ...c, isActive: false, updatedAt: expect.any(String) });
    expect((await publicView()).coordinators).toEqual([]);
    /* Still listed and viewable here, ready to switch back on. */
    expect(idsOf(await list())).toEqual([c.id]);

    const on = await setStatus(c.id, { isActive: true });
    expect(on.body.data.isActive).toBe(true);
    expect((await publicView()).coordinators).toEqual([{ name: 'Asha Patil', phone: '+91 98000 11001', districts: [{ code: 'SAT', name: 'Satara' }] }]);

    expect((await setStatus(c.id, { isActive: 'yes' })).status).toBe(422);
    expect((await setStatus(c.id, {})).status).toBe(422);
    expect((await setStatus(MISSING_ID, { isActive: false })).status).toBe(404);
  });

  it('soft-deletes a card: gone from the list, the page and the website, its districts free again', async () => {
    const c = await make({ name: 'Asha Patil', phone: '+91 98000 12001', districtIds: [d.Satara.id, d.Sangli.id] });

    const res = await remove(c.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();

    expect((await get(c.id)).status).toBe(404);
    expect((await patch(c.id, { name: 'Back again' })).status).toBe(404);
    expect((await setStatus(c.id, { isActive: true })).status).toBe(404);
    expect((await remove(c.id)).status).toBe(404);
    expect((await list()).body.meta.total).toBe(0);
    expect((await adminView()).coordinators).toEqual([]);
    expect((await publicView()).coordinators).toEqual([]);

    /* The row stays, retired, without its district links. */
    const [row] = await AppDataSource.query(
      `SELECT "isDelete", "isActive", (SELECT count(*) FROM "contact_coordinator_districts" WHERE "coordinatorId" = $1)::int AS links
       FROM "contact_coordinators" WHERE "id" = $1`,
      [c.id],
    );
    expect(row).toEqual({ isDelete: true, isActive: false, links: 0 });
    expect((await post({ name: 'Bhushan Rao', phone: '+91 98000 12002', districtIds: [d.Satara.id] })).status).toBe(201);
  });

  it('feeds the website and the whole-page read, in display order with the saved district order', async () => {
    await make({ name: 'Second', phone: '+91 98000 13002', districtIds: [d.Solapur.id], displayOrder: 2 });
    await make({ name: 'First', phone: '+91 98000 13001', email: 'first@sumago.demo', districtIds: [d.Satara.id, d.Sangli.id], displayOrder: 1 });

    expect((await publicView()).coordinators).toEqual([
      { name: 'First', phone: '+91 98000 13001', email: 'first@sumago.demo', districts: [{ code: 'SAT', name: 'Satara' }, { code: 'SAN', name: 'Sangli' }] },
      { name: 'Second', phone: '+91 98000 13002', districts: [{ code: 'SOL', name: 'Solapur' }] },
    ]);

    /* GET /cms/contact carries the same cards as the list, timestamps included. */
    const page = await adminView();
    expect(page.coordinators).toEqual((await list()).body.data);
    expect(page.coordinators[0]).toEqual(expect.objectContaining({ createdAt: expect.any(String), updatedAt: expect.any(String) }));

    /* A PUT that omits the coordinators list leaves the cards made here as they are. */
    await request(app).put(ADMIN_URL).set(auth(admin.token)).send(validPayload()).expect(200);
    expect((await adminView()).coordinators).toEqual(page.coordinators);
  });

  it('records every write in the audit log as a Contact page change', async () => {
    const c = await make({ name: 'Audited', phone: '+91 98000 14001' });
    await patch(c.id, { name: 'Audited again' }).expect(200);
    await setStatus(c.id, { isActive: false }).expect(200);
    await remove(c.id).expect(200);

    const logs = await request(app).get(`${API}/audit-logs`).query({ action: 'cms.contact-page.update', limit: 100 }).set(auth(admin.token));
    expect(logs.status).toBe(200);
    const entries = (logs.body.data as { resource: string; details: { id?: string } }[]).filter((l) => l.details?.id === c.id);
    expect(entries.map((l) => l.resource)).toEqual(['contact-page', 'contact-page', 'contact-page', 'contact-page']);
    expect(entries.map((l) => l.details)).toEqual(
      expect.arrayContaining(['create', 'update', 'status', 'delete'].map((op) => ({ section: 'coordinators', op, id: c.id }))),
    );
  });
});

describe('Contact district offices, one entry at a time', () => {
  let d: Record<string, ApiRef>;

  const post = (body: object) => request(app).post(OFFICES_URL).set(auth(admin.token)).send(body);
  const patch = (id: string, body: object) => request(app).patch(`${OFFICES_URL}/${id}`).set(auth(admin.token)).send(body);
  const setStatus = (id: string, body: object) => request(app).patch(`${OFFICES_URL}/${id}/status`).set(auth(admin.token)).send(body);
  const get = (id: string) => request(app).get(`${OFFICES_URL}/${id}`).set(auth(admin.token));
  const remove = (id: string) => request(app).delete(`${OFFICES_URL}/${id}`).set(auth(admin.token));
  const list = (q: Record<string, string | number> = {}) => request(app).get(OFFICES_URL).query(q).set(auth(admin.token));
  const districtNames = (res: { body: { data: ApiDistrictOffice[] } }) => res.body.data.map((o) => o.district.name);
  const make = async (body: object): Promise<ApiDistrictOffice> => {
    const res = await post(body);
    if (res.status !== 201) throw new Error(`POST district office failed (${res.status}): ${JSON.stringify(res.body)}`);
    return res.body.data;
  };

  const FULL = {
    collectorName: 'Collector Akola',
    address: { mr: 'जिल्हाधिकारी कार्यालय, अकोला', en: 'Collectorate, Akola' },
    phone: '0724 243 5000',
    email: 'Collector.Akola@Maharashtra.gov.in',
    officeHours: { mr: 'सोम–शुक्र', en: 'Mon–Fri, 10:00 – 17:45' },
  };

  beforeAll(async () => {
    ({ districts: d } = await sectionDistricts('Office Test State', 'OTS', [
      ['Akola', 'AKO'], ['Beed', 'BEE'], ['Latur', 'LAT'], ['Thane', 'THA'], ['Wardha', 'WAR'],
    ]));
    await publish();
  });
  beforeEach(clearSections);
  afterAll(clearSections);

  it('creates an entry with just its district, or with every field', async () => {
    const bare = await post({ districtId: d.Latur.id });
    expect(bare.status).toBe(201);
    expect(bare.body.data).toEqual({
      id: expect.any(String), district: d.Latur, collectorName: null, address: null, phone: null, email: null, officeHours: null,
      isActive: true, createdAt: expect.any(String), updatedAt: expect.any(String),
    });

    const full = await make({ districtId: d.Akola.id, ...FULL, isActive: false });
    expect(full).toMatchObject({ ...FULL, district: d.Akola, email: 'collector.akola@maharashtra.gov.in', isActive: false });
  });

  it('gets one entry (404 when missing, 422 for a malformed id)', async () => {
    const o = await make({ districtId: d.Beed.id, collectorName: 'Collector Beed' });
    const res = await get(o.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(o);
    expect((await get(MISSING_ID)).status).toBe(404);
    expect((await get('not-a-uuid')).status).toBe(422);
  });

  it('refuses a second live entry for a district (409) and an unknown district (400)', async () => {
    await make({ districtId: d.Latur.id });
    const twice = await post({ districtId: d.Latur.id, collectorName: 'Someone else' });
    expect(twice.status).toBe(409);
    expect(twice.body.message).toBe('Latur already has an office entry');
    expect(twice.body.error).toMatchObject({ code: 'CONFLICT', details: [{ field: 'districtId', message: 'Latur already has an office entry' }] });

    const unknown = await post({ districtId: MISSING_ID });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.details).toEqual([{ field: 'districtId', message: 'Unknown district' }]);

    expect((await post({ collectorName: 'No district' })).status).toBe(422);
    expect((await post({ districtId: d.Beed.id, phone: '+91 20XXX 12345' })).status).toBe(422);
    expect((await list()).body.meta.total).toBe(1);
  });

  it('lists a page at a time, by district name unless sorted otherwise', async () => {
    await make({ districtId: d.Thane.id, collectorName: 'B Collector' });
    await make({ districtId: d.Akola.id, collectorName: 'C Collector' });
    await make({ districtId: d.Latur.id, collectorName: 'A Collector' });

    const first = await list({ limit: 2 });
    expect(first.status).toBe(200);
    expect(districtNames(first)).toEqual(['Akola', 'Latur']);
    expect(first.body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
    const second = await list({ limit: 2, page: 2 });
    expect(districtNames(second)).toEqual(['Thane']);
    expect(second.body.meta).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });

    expect(districtNames(await list({ sortOrder: 'desc' }))).toEqual(['Thane', 'Latur', 'Akola']);
    expect(districtNames(await list({ sortBy: 'collectorName' }))).toEqual(['Latur', 'Thane', 'Akola']);
    expect(districtNames(await list({ sortBy: 'createdAt', sortOrder: 'desc' }))).toEqual(['Latur', 'Akola', 'Thane']);
    expect((await list({ sortBy: 'phone' })).status).toBe(422);
  });

  it('searches district name and code, collector, phone and email, ignoring case', async () => {
    const akola = await make({ districtId: d.Akola.id, ...FULL });
    const wardha = await make({ districtId: d.Wardha.id, collectorName: 'Collector Wardha', phone: '07152 243 446', email: 'collector.wardha@maharashtra.gov.in' });
    const found = async (search: string) => idsOf(await list({ search }));

    expect(await found('akola')).toEqual([akola.id]);
    expect(await found('war')).toEqual([wardha.id]);
    expect(await found('COLLECTOR WARDHA')).toEqual([wardha.id]);
    expect(await found('243 446')).toEqual([wardha.id]);
    expect(await found('maharashtra.gov.in')).toEqual([akola.id, wardha.id]);
    expect(await found('nobody')).toEqual([]);
    expect(await found('_')).toEqual([]);
  });

  it('lists inactive entries too, unless filtered by status', async () => {
    const on = await make({ districtId: d.Akola.id });
    const off = await make({ districtId: d.Beed.id, isActive: false });
    expect(idsOf(await list())).toEqual([on.id, off.id]);
    expect(idsOf(await list({ isActive: 'true' }))).toEqual([on.id]);
    expect(idsOf(await list({ isActive: 'false' }))).toEqual([off.id]);
  });

  it('updates any subset of the fields; null clears one', async () => {
    const o = await make({ districtId: d.Akola.id, ...FULL });

    const renamed = await patch(o.id, { collectorName: 'New Collector' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toEqual({ ...o, collectorName: 'New Collector', updatedAt: expect.any(String) });

    const cleared = await patch(o.id, { address: null, phone: null, officeHours: { mr: 'सोम–शनि', en: 'Mon–Sat' } });
    expect(cleared.body.data).toMatchObject({
      collectorName: 'New Collector', address: null, phone: null, email: 'collector.akola@maharashtra.gov.in', officeHours: { mr: 'सोम–शनि', en: 'Mon–Sat' },
    });

    expect((await patch(o.id, {})).status).toBe(422);
    expect((await patch(o.id, { address: { mr: 'फक्त मराठी' } })).status).toBe(422);
    expect((await patch(o.id, { email: 'not-an-email' })).status).toBe(422);
    expect((await patch(MISSING_ID, { collectorName: 'Nobody' })).status).toBe(404);
  });

  it('moves an entry to a free district, but not to a taken or unknown one', async () => {
    const o = await make({ districtId: d.Akola.id, collectorName: 'Mover' });
    await make({ districtId: d.Beed.id });

    const moved = await patch(o.id, { districtId: d.Latur.id });
    expect(moved.status).toBe(200);
    expect(moved.body.data).toMatchObject({ district: d.Latur, collectorName: 'Mover' });
    /* Sending its own district again is not a clash. */
    expect((await patch(o.id, { districtId: d.Latur.id, collectorName: 'Mover' })).status).toBe(200);

    const taken = await patch(o.id, { districtId: d.Beed.id });
    expect(taken.status).toBe(409);
    expect(taken.body.error.details).toEqual([{ field: 'districtId', message: 'Beed already has an office entry' }]);
    expect((await patch(o.id, { districtId: MISSING_ID })).status).toBe(400);
    expect((await get(o.id)).body.data.district).toEqual(d.Latur);
    /* The district it left is free again. */
    expect((await post({ districtId: d.Akola.id })).status).toBe(201);
  });

  it('activates and deactivates an entry; the website shows active entries only', async () => {
    const o = await make({ districtId: d.Akola.id, collectorName: 'Collector Akola' });

    const off = await setStatus(o.id, { isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.data).toEqual({ ...o, isActive: false, updatedAt: expect.any(String) });
    expect((await publicView()).districtOffices).toEqual([]);

    expect((await setStatus(o.id, { isActive: true })).body.data.isActive).toBe(true);
    expect((await publicView()).districtOffices).toEqual([{ district: { code: 'AKO', name: 'Akola' }, collectorName: 'Collector Akola' }]);

    expect((await setStatus(o.id, { isActive: 'no' })).status).toBe(422);
    expect((await setStatus(MISSING_ID, { isActive: true })).status).toBe(404);
  });

  it('soft-deletes an entry: gone everywhere, and its district free for a new one', async () => {
    const o = await make({ districtId: d.Thane.id, collectorName: 'Collector Thane' });

    const res = await remove(o.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();

    expect((await get(o.id)).status).toBe(404);
    expect((await patch(o.id, { collectorName: 'Back again' })).status).toBe(404);
    expect((await setStatus(o.id, { isActive: true })).status).toBe(404);
    expect((await remove(o.id)).status).toBe(404);
    expect((await list()).body.meta.total).toBe(0);
    expect((await adminView()).districtOffices).toEqual([]);
    expect((await publicView()).districtOffices).toEqual([]);

    const [row] = await AppDataSource.query(`SELECT "isDelete", "isActive" FROM "contact_district_offices" WHERE "id" = $1`, [o.id]);
    expect(row).toEqual({ isDelete: true, isActive: false });
    expect((await post({ districtId: d.Thane.id })).status).toBe(201);
  });

  it('feeds the website and the whole-page read in district-name order, blanks omitted publicly', async () => {
    await make({ districtId: d.Wardha.id, phone: '07152 243 446' });
    await make({ districtId: d.Akola.id, ...FULL });

    expect((await publicView()).districtOffices).toEqual([
      {
        district: { code: 'AKO', name: 'Akola' }, collectorName: FULL.collectorName, address: FULL.address, phone: FULL.phone,
        email: 'collector.akola@maharashtra.gov.in', officeHours: FULL.officeHours,
      },
      { district: { code: 'WAR', name: 'Wardha' }, phone: '07152 243 446' },
    ]);

    const page = await adminView();
    expect(page.districtOffices).toEqual((await list()).body.data);
    expect(page.districtOffices[0]).toEqual(expect.objectContaining({ createdAt: expect.any(String), updatedAt: expect.any(String) }));

    await request(app).put(ADMIN_URL).set(auth(admin.token)).send(validPayload()).expect(200);
    expect((await adminView()).districtOffices).toEqual(page.districtOffices);
  });

  it('records every write in the audit log as a Contact page change', async () => {
    const o = await make({ districtId: d.Beed.id });
    await patch(o.id, { collectorName: 'Audited' }).expect(200);
    await setStatus(o.id, { isActive: false }).expect(200);
    await remove(o.id).expect(200);

    const logs = await request(app).get(`${API}/audit-logs`).query({ action: 'cms.contact-page.update', limit: 100 }).set(auth(admin.token));
    const entries = (logs.body.data as { details: { id?: string } }[]).filter((l) => l.details?.id === o.id);
    expect(entries.map((l) => l.details)).toEqual(
      expect.arrayContaining(['create', 'update', 'status', 'delete'].map((op) => ({ section: 'district-offices', op, id: o.id }))),
    );
    expect(entries).toHaveLength(4);
  });
});

describe('Contact sections while the page is not configured', () => {
  it('answer 404 on every endpoint, reads and writes alike', async () => {
    await clearSections();
    const { districts } = await sectionDistricts('Unconfigured Test State', 'UTS', [['Jalna', 'JLN']]);
    const coordinator = await request(app).post(COORDINATORS_URL).set(auth(admin.token)).send({ name: 'Kept', phone: '+91 98000 15001' }).expect(201);
    const office = await request(app).post(OFFICES_URL).set(auth(admin.token)).send({ districtId: districts.Jalna.id }).expect(201);
    const c = coordinator.body.data.id as string;
    const o = office.body.data.id as string;

    await AppDataSource.query(`UPDATE "contact_page_settings" SET "isDelete" = true WHERE NOT "isDelete"`);
    try {
      const calls = [
        ['list coordinators', request(app).get(COORDINATORS_URL)],
        ['get coordinator', request(app).get(`${COORDINATORS_URL}/${c}`)],
        ['create coordinator', request(app).post(COORDINATORS_URL).send({ name: 'New', phone: '+91 98000 15002' })],
        ['update coordinator', request(app).patch(`${COORDINATORS_URL}/${c}`).send({ name: 'Renamed' })],
        ['coordinator status', request(app).patch(`${COORDINATORS_URL}/${c}/status`).send({ isActive: false })],
        ['delete coordinator', request(app).delete(`${COORDINATORS_URL}/${c}`)],
        ['list offices', request(app).get(OFFICES_URL)],
        ['get office', request(app).get(`${OFFICES_URL}/${o}`)],
        ['create office', request(app).post(OFFICES_URL).send({ districtId: districts.Jalna.id })],
        ['update office', request(app).patch(`${OFFICES_URL}/${o}`).send({ collectorName: 'Renamed' })],
        ['office status', request(app).patch(`${OFFICES_URL}/${o}/status`).send({ isActive: false })],
        ['delete office', request(app).delete(`${OFFICES_URL}/${o}`)],
      ] as const;
      for (const [call, pending] of calls) {
        const res = await pending.set(auth(admin.token));
        expect({ call, status: res.status, message: res.body.message }).toEqual({
          call, status: 404, message: expect.stringMatching(/^The Contact page has not been configured yet/),
        });
      }
    } finally {
      await AppDataSource.query(
        `UPDATE "contact_page_settings" SET "isDelete" = false WHERE "id" = (SELECT "id" FROM "contact_page_settings" ORDER BY "createdAt" LIMIT 1)`,
      );
      await clearSections();
    }
  });
});

describe('Contact sections and permissions', () => {
  let wa: TestActor;
  let d: Record<string, ApiRef>;

  beforeAll(async () => {
    const user = await createUser({ roleCodes: [ROLE_CODES.WEBSITE_ADMIN] });
    wa = { user, token: await login(user.email) };
    ({ districts: d } = await sectionDistricts('Permission Test State', 'PTS', [['Gondia', 'GON'], ['Bhandara', 'BHA']]));
    await publish();
  });
  beforeEach(clearSections);
  afterAll(clearSections);

  it('a Website Admin can list, view, create, edit, switch and delete coordinators', async () => {
    const created = await request(app)
      .post(COORDINATORS_URL)
      .set(auth(wa.token))
      .send({ name: 'Web Admin Card', phone: '+91 98000 16001', districtIds: [d.Gondia.id] });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    expect((await request(app).get(COORDINATORS_URL).set(auth(wa.token))).body.data).toHaveLength(1);
    expect((await request(app).get(`${COORDINATORS_URL}/${id}`).set(auth(wa.token))).status).toBe(200);
    const edited = await request(app).patch(`${COORDINATORS_URL}/${id}`).set(auth(wa.token)).send({ districtIds: [d.Bhandara.id, d.Gondia.id] });
    expect(edited.status).toBe(200);
    expect(edited.body.data.districts).toEqual([d.Bhandara, d.Gondia]);
    expect((await request(app).patch(`${COORDINATORS_URL}/${id}/status`).set(auth(wa.token)).send({ isActive: false })).status).toBe(200);
    expect((await request(app).delete(`${COORDINATORS_URL}/${id}`).set(auth(wa.token))).status).toBe(200);
    expect((await request(app).get(`${COORDINATORS_URL}/${id}`).set(auth(wa.token))).status).toBe(404);
  });

  it('a Website Admin can list, view, create, edit, switch and delete district offices', async () => {
    const created = await request(app).post(OFFICES_URL).set(auth(wa.token)).send({ districtId: d.Gondia.id, collectorName: 'Collector Gondia' });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    expect((await request(app).get(OFFICES_URL).set(auth(wa.token))).body.data).toHaveLength(1);
    expect((await request(app).get(`${OFFICES_URL}/${id}`).set(auth(wa.token))).status).toBe(200);
    expect((await request(app).patch(`${OFFICES_URL}/${id}`).set(auth(wa.token)).send({ districtId: d.Bhandara.id })).body.data.district).toEqual(d.Bhandara);
    expect((await request(app).patch(`${OFFICES_URL}/${id}/status`).set(auth(wa.token)).send({ isActive: false })).status).toBe(200);
    expect((await request(app).delete(`${OFFICES_URL}/${id}`).set(auth(wa.token))).status).toBe(200);
    expect((await request(app).get(`${OFFICES_URL}/${id}`).set(auth(wa.token))).status).toBe(404);
  });

  it('a view-only actor can read both sections but not write them (403)', async () => {
    const c = (await request(app).post(COORDINATORS_URL).set(auth(admin.token)).send({ name: 'Read only', phone: '+91 98000 16002' }).expect(201)).body.data;
    const o = (await request(app).post(OFFICES_URL).set(auth(admin.token)).send({ districtId: d.Gondia.id }).expect(201)).body.data;
    const viewer = await actorWith(['cms-contact.view']);
    const headers = auth(viewer.token);

    for (const url of [COORDINATORS_URL, `${COORDINATORS_URL}/${c.id}`, OFFICES_URL, `${OFFICES_URL}/${o.id}`]) {
      expect({ url, status: (await request(app).get(url).set(headers)).status }).toEqual({ url, status: 200 });
    }
    const writes = [
      request(app).post(COORDINATORS_URL).send({ name: 'No', phone: '+91 98000 16003' }),
      request(app).patch(`${COORDINATORS_URL}/${c.id}`).send({ name: 'No' }),
      request(app).patch(`${COORDINATORS_URL}/${c.id}/status`).send({ isActive: false }),
      request(app).delete(`${COORDINATORS_URL}/${c.id}`),
      request(app).post(OFFICES_URL).send({ districtId: d.Bhandara.id }),
      request(app).patch(`${OFFICES_URL}/${o.id}`).send({ collectorName: 'No' }),
      request(app).patch(`${OFFICES_URL}/${o.id}/status`).send({ isActive: false }),
      request(app).delete(`${OFFICES_URL}/${o.id}`),
    ];
    for (const write of writes) expect((await write.set(headers)).status).toBe(403);
  });

  it('an actor without the Contact codes cannot read them, and a session is required', async () => {
    const outsider = await actorWith(['users.view']);
    expect((await request(app).get(COORDINATORS_URL).set(auth(outsider.token))).status).toBe(403);
    expect((await request(app).get(OFFICES_URL).set(auth(outsider.token))).status).toBe(403);
    expect((await request(app).get(COORDINATORS_URL)).status).toBe(401);
    expect((await request(app).post(OFFICES_URL).send({ districtId: d.Gondia.id })).status).toBe(401);
  });
});
