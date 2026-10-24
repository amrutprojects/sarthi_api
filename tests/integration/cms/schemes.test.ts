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
import { seedAmrutSchemes } from '../../../src/database/seeds/seed-amrut-schemes';
import { auditService } from '../../../src/modules/audit/audit.service';

const ADMIN_URL = `${API}/cms/schemes`;
const PUBLIC_URL = `${API}/public/schemes`;

let app: Express;
let admin: TestActor;

interface Pair {
  mr: string;
  en: string;
}
interface AdminScheme {
  id: string;
  title: Pair;
  description: Pair;
  badge: Pair;
  deadline: string | null;
  link: string | null;
  buttonLabel: Pair;
  featured: boolean;
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
const DEFAULT_LABEL = pair('अधिक जाणून घ्या', 'Learn more');

/* The six schemes the website showed before the section was managed (content/schemes.ts), in order. */
const SEEDED = [
  {
    title: pair('अमृत कलश - कौशल्य प्रशिक्षण', 'AMRUT Kalash - Skill Training'),
    description: pair(
      'महाराष्ट्रातील खुल्या प्रवर्गातील आर्थिकदृष्ट्या दुर्बल घटकातील युवकांना २१ व्या शतकातील रोजगारक्षम कौशल्ये, संगणक कौशल्ये व इंग्रजी संभाषण कौशल्ये यांचे प्रशिक्षण देऊन रोजगार व स्वयंरोजगारक्षम बनविणे.',
      'Equipping economically weaker youth from the open category with 21st-century job-readiness skills, digital skills and English communication skills for employment and self-employment.',
    ),
    badge: pair('हा कार्यक्रम', 'This programme'),
    deadline: '2027-03-31',
    link: '/programme',
    featured: true,
  },
  {
    title: pair('मानसमित्र समुपदेशक प्रशिक्षण कार्यक्रम', 'Manasmitra Counsellor Training Programme'),
    description: pair(
      'समाजातील व्यक्तींना मूलभूत समुपदेशन कौशल्यांचे प्रशिक्षण देऊन मानसिक आरोग्याबाबत जागरूकता निर्माण करणे.',
      'Building mental-health awareness by training individuals in basic counselling skills.',
    ),
    badge: BLANK,
    deadline: '2026-06-29',
    link: null,
    featured: false,
  },
  {
    title: pair('लघुलेखन प्रशिक्षण योजना', 'Shorthand Training Scheme'),
    description: pair(
      'शासकीय ऑनलाईन लघुलेखन परीक्षेच्या माध्यमातून उमेदवारांना उद्योगाभिमुख स्वयंरोजगार व रोजगारक्षम बनविणे.',
      'Making candidates employable through the government online shorthand examination.',
    ),
    badge: BLANK,
    deadline: '2026-06-09',
    link: null,
    featured: false,
  },
  {
    title: pair('ड्रोन पायलट प्रशिक्षण योजना', 'Drone Pilot Training Scheme'),
    description: pair(
      'विशेषत: ग्रामीण क्षेत्रात स्वयंरोजगार व रोजगार निर्मिती करणारे प्रशिक्षण देणे.',
      'Training that creates self-employment and jobs, especially in rural areas.',
    ),
    badge: BLANK,
    deadline: '2026-06-30',
    link: null,
    featured: false,
  },
  {
    title: pair('AIIMS, IIT, IIM, IIIT विद्यार्थ्यांना अर्थसहाय्य योजना', 'Financial Assistance for AIIMS / IIT / IIM / IIIT Students'),
    description: pair(
      'अमृतच्या लक्षित गटातील विद्यार्थ्यांना दर्जेदार शिक्षण घेणे सोयीस्कर होण्यासाठी अर्थसहाय्य देणे.',
      "Financial assistance so students from AMRUT's target group can access quality education.",
    ),
    badge: BLANK,
    deadline: '2026-03-11',
    link: null,
    featured: false,
  },
  {
    title: pair('वैयक्तिक कर्ज व्याज परतावा योजना', 'Personal Loan Interest Subvention Scheme'),
    description: pair(
      'स्वत:चा उद्योग / व्यवसाय सुरु करू इच्छिणाऱ्या अमृतच्या लक्षित गटातील उमेदवारांसाठी.',
      "For candidates from AMRUT's target group wishing to start their own business.",
    ),
    badge: BLANK,
    deadline: '2030-12-31',
    link: null,
    featured: false,
  },
];

const scheme = (n: number, extra: Record<string, unknown> = {}) => ({
  title: pair(`अमृत योजना चाचणी ${n}`, `Scheme Test ${n}`),
  description: pair('मराठी चाचणी वर्णन — ज्ञ, क्ष', 'Test description'),
  ...extra,
});

const details = (res: { body: { error: { details: Detail[] } } }) => res.body.error.details;
const list = async (): Promise<AdminScheme[]> => (await request(app).get(ADMIN_URL).set(auth(admin.token)).expect(200)).body.data;
const publicCards = async () => (await request(app).get(PUBLIC_URL).expect(200)).body.data.schemes as Record<string, unknown>[];
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
const get = async (id: string): Promise<AdminScheme> =>
  (await request(app).get(`${ADMIN_URL}/${id}`).set(auth(admin.token)).expect(200)).body.data;
const countRows = async () =>
  (await AppDataSource.query(`SELECT count(*)::int AS n FROM "amrut_schemes" WHERE "isDelete" = false`))[0].n as number;

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
});
afterAll(teardownTestApp);
afterEach(() => jest.restoreAllMocks());

describe('AMRUT Schemes — before the seed', () => {
  it('the public feed is null while the section is not configured', async () => {
    expect((await request(app).get(PUBLIC_URL).expect(200)).body.data).toBeNull();
    expect((await request(app).get(`${ADMIN_URL}/settings`).set(auth(admin.token))).status).toBe(404);
  });
});

describe('AMRUT Schemes seed', () => {
  it('seeds exactly the six schemes, heading, subtitle and button label the website showed', async () => {
    expect(await seedAmrutSchemes(AppDataSource)).toEqual({ created: true, schemesCreated: 6 });
    const rows = await list();
    expect(
      rows.map(({ title, description, badge, deadline, link, featured }) => ({ title, description, badge, deadline, link, featured })),
    ).toEqual(SEEDED);
    expect(rows.map((r) => [r.displayOrder, r.isActive, r.buttonLabel])).toEqual(SEEDED.map((_, i) => [i + 1, true, BLANK]));

    const pub = (await request(app).get(PUBLIC_URL).expect(200)).body.data;
    expect(pub).toMatchObject({
      heading: pair('अमृत योजना विभाग', 'AMRUT Schemes'),
      subtitle: pair(
        'अमृत संस्थेद्वारे राबवल्या जाणाऱ्या विविध प्रशिक्षण व विकास योजना.',
        'Training and development schemes implemented by AMRUT.',
      ),
      showSection: true,
    });
    expect(pub.schemes.map(({ id: _id, ...card }: Record<string, unknown>) => card)).toEqual(
      SEEDED.map((s) => ({ ...s, badge: s.badge.mr ? s.badge : null, buttonLabel: DEFAULT_LABEL })),
    );
  });

  it('keeps expired schemes on the website (nothing hides a scheme when its last date passes)', async () => {
    const titles = (await publicCards()).map((c) => (c.title as Pair).en);
    /* 11 Mar 2026 is long past; the scheme is still listed, as the bundled cards always were. */
    expect(titles).toContain('Financial Assistance for AIIMS / IIT / IIM / IIIT Students');
  });

  it('is idempotent and never brings back a deleted scheme', async () => {
    const [, second] = await list();
    await request(app).delete(`${ADMIN_URL}/${second!.id}`).set(auth(admin.token)).expect(200);
    expect(await seedAmrutSchemes(AppDataSource)).toEqual({ created: false, schemesCreated: 0 });
    expect((await list()).map((r) => r.id)).not.toContain(second!.id);
    /* Put the scheme back for the rest of the suite, as a new record. */
    const { featured: _f, ...rest } = SEEDED[1]!;
    await create({ ...rest, displayOrder: 2 }).expect(201);
  });
});

describe('Adding a scheme', () => {
  it('adds a seventh scheme at the end, trims the text and keeps Marathi intact', async () => {
    const res = await create(
      scheme(1, { title: pair('  अमृत योजना   चाचणी 1 ', 'Scheme Test 1'), deadline: '2027-01-15', link: '/apply' }),
    );
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      title: pair('अमृत योजना चाचणी 1', 'Scheme Test 1'),
      description: pair('मराठी चाचणी वर्णन — ज्ञ, क्ष', 'Test description'),
      badge: BLANK,
      deadline: '2027-01-15',
      link: '/apply',
      buttonLabel: BLANK,
      featured: false,
      isActive: true,
      displayOrder: 7,
    });
    const cards = await publicCards();
    expect(cards).toHaveLength(7);
    expect(cards[6]).toMatchObject({
      title: pair('अमृत योजना चाचणी 1', 'Scheme Test 1'),
      badge: null,
      buttonLabel: DEFAULT_LABEL,
      deadline: '2027-01-15',
    });
  });

  it('stores the last date as the calendar day sent — no time zone shift — and allows none', async () => {
    const withDate = (await create(scheme(2, { deadline: '2027-01-01' })).expect(201)).body.data as AdminScheme;
    const [row] = await AppDataSource.query(`SELECT "deadline"::text AS d FROM "amrut_schemes" WHERE "id" = $1`, [withDate.id]);
    expect(row.d).toBe('2027-01-01');
    expect((await get(withDate.id)).deadline).toBe('2027-01-01');

    const without = (await create(scheme(3)).expect(201)).body.data as AdminScheme;
    expect(without.deadline).toBeNull();
    expect((await create(scheme(4, { deadline: '  ' })).expect(201)).body.data.deadline).toBeNull();
  });

  it('supports more schemes than the original six, an external address, its own badge and button label', async () => {
    await create(
      scheme(5, { link: 'https://example.gov.in/s5', badge: pair('नवीन', 'New'), buttonLabel: pair('अर्ज करा', 'Apply'), featured: true }),
    ).expect(201);
    const cards = await publicCards();
    expect(cards.length).toBeGreaterThan(6);
    expect(cards[cards.length - 1]).toMatchObject({
      link: 'https://example.gov.in/s5',
      badge: pair('नवीन', 'New'),
      buttonLabel: pair('अर्ज करा', 'Apply'),
      featured: true,
    });
  });

  it('refuses a duplicate title (either language, any case)', async () => {
    const res = await create(scheme(9, { title: pair('लघुलेखन प्रशिक्षण योजना', 'Something else') }));
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('A scheme titled "लघुलेखन प्रशिक्षण योजना" / "Shorthand Training Scheme" already exists.');
    expect((await create(scheme(9, { title: pair('नवीन', 'shorthand TRAINING scheme') }))).status).toBe(409);
  });

  it('replays a double-submitted form (same Idempotency-Key) instead of adding the scheme twice', async () => {
    const KEY = 'schemes-test-key-0006';
    const before = await countRows();
    const send = () => create(scheme(6)).set('Idempotency-Key', KEY);
    const first = await send();
    expect(first.status).toBe(201);
    /*
     * The middleware records the first response once it has been sent, so a retry in that instant is
     * told the request is still in progress (409) — never given a second scheme. Wait for the record,
     * as a real retry after a lost response would, then expect the replay.
     */
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

  it('answers a retry that overlaps the first request without adding a second scheme', async () => {
    const before = await countRows();
    const send = () => create(scheme(11)).set('Idempotency-Key', 'schemes-test-key-0011');
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status].sort()).toEqual(expect.arrayContaining([201]));
    for (const r of [a, b]) expect([201, 409]).toContain(r.status);
    expect(await countRows()).toBe(before + 1);
  });
});

describe('Validation', () => {
  it('names each missing field', async () => {
    const res = await create({ description: pair('', 'x') });
    expect(res.status).toBe(422);
    expect(
      details(res)
        .map((d) => d.field)
        .sort(),
    ).toEqual(['body.description.mr', 'body.title']);
    expect(details(res)).toContainEqual({ field: 'body.title', message: 'Scheme title is required' });
  });

  it('refuses blank halves, over-long text and a half-filled badge or button label', async () => {
    const res = await create(
      scheme(7, {
        title: pair('   ', 'x'.repeat(151)),
        description: pair('d', 'y'.repeat(501)),
        badge: pair('फक्त मराठी', ''),
        buttonLabel: pair('', 'Only English'),
      }),
    );
    expect(res.status).toBe(422);
    expect(details(res)).toEqual(
      expect.arrayContaining([
        { field: 'body.title.mr', message: 'Scheme title (Marathi) is required' },
        { field: 'body.title.en', message: 'Scheme title (English) must be at most 150 characters' },
        { field: 'body.description.en', message: 'Description (English) must be at most 500 characters' },
        { field: 'body.badge.en', message: 'Badge (English) is required when the Marathi text is filled in' },
        { field: 'body.buttonLabel.mr', message: 'Button label (Marathi) is required when the English text is filled in' },
      ]),
    );
  });

  it.each([
    ['2026-02-30', 'Last date is not a real calendar date'],
    ['2027-13-01', 'Last date is not a real calendar date'],
    ['31/03/2027', 'Last date must be a date in the format YYYY-MM-DD'],
    ['2027-03-31T00:00:00Z', 'Last date must be a date in the format YYYY-MM-DD'],
    ['tomorrow', 'Last date must be a date in the format YYYY-MM-DD'],
    ['1999-12-31', 'Last date must be between the years 2000 and 2100'],
    ['2101-01-01', 'Last date must be between the years 2000 and 2100'],
    [20270331, 'Last date must be a date or null'],
  ])('refuses the last date %j', async (deadline, message) => {
    const res = await create(scheme(8, { deadline }));
    expect(res.status).toBe(422);
    expect(details(res)).toEqual([{ field: 'body.deadline', message }]);
  });

  it.each([
    ['javascript:alert(1)', 'Destination must be a page on this site starting with /, or a web address starting with https:// or www.'],
    ['data:text/html,hi', 'Destination must be a page on this site starting with /, or a web address starting with https:// or www.'],
    ['//evil.example.com', 'A page on this site must start with a single / and use only letters, digits and - _ . ~ / ? = & % #'],
    ['/apply"><script>', 'A page on this site must start with a single / and use only letters, digits and - _ . ~ / ? = & % #'],
    ['programme', 'Destination must be a page on this site starting with /, or a web address starting with https:// or www.'],
    ['https://user:pw@example.gov.in', 'The address must not contain a user name or password'],
    ['https://localhost/x', 'Enter a full address, e.g. https://example.gov.in'],
  ])('refuses the destination %j', async (link, message) => {
    const res = await create(scheme(8, { link }));
    expect(res.status).toBe(422);
    expect(details(res)).toEqual([{ field: 'body.link', message }]);
  });

  it('refuses unknown fields, a non-boolean highlight and a destination that is not text', async () => {
    const res = await create(scheme(8, { featured: 'yes', link: 42, html: '<b>x</b>' }));
    expect(res.status).toBe(422);
    expect(
      details(res)
        .map((d) => d.field)
        .sort(),
    ).toEqual(['body', 'body.featured', 'body.link']);
    expect(details(res)).toContainEqual({ field: 'body.link', message: 'Destination must be text or null' });
  });

  it('answers 422 for a malformed id and 404 for an unknown one', async () => {
    expect((await request(app).get(`${ADMIN_URL}/nope`).set(auth(admin.token))).status).toBe(422);
    const unknown = '00000000-0000-4000-8000-000000000000';
    expect((await request(app).get(`${ADMIN_URL}/${unknown}`).set(auth(admin.token))).status).toBe(404);
    expect((await patch(unknown, { featured: true })).status).toBe(404);
    expect((await request(app).delete(`${ADMIN_URL}/${unknown}`).set(auth(admin.token))).status).toBe(404);
  });
});

describe('Editing a scheme', () => {
  let s: AdminScheme;
  beforeAll(async () => {
    s = (await create(scheme(10, { link: '/faq', deadline: '2026-12-31', badge: pair('नवीन', 'New') })).expect(201)).body.data;
  });

  it('changes only the fields sent', async () => {
    const res = await patch(s.id, { deadline: '2027-06-30' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      title: s.title,
      description: s.description,
      badge: pair('नवीन', 'New'),
      link: '/faq',
      deadline: '2027-06-30',
      displayOrder: s.displayOrder,
    });
    s = res.body.data;
  });

  it('updates title, description, badge, deadline and destination together, and can clear the optional ones', async () => {
    const res = await patch(s.id, {
      title: pair('सुधारित चाचणी', 'Updated test'),
      description: pair('सुधारित वर्णन', 'Updated description'),
      badge: pair('अंतिम संधी', 'Last chance'),
      deadline: '2028-02-29',
      link: 'https://example.gov.in/updated',
      expectedUpdatedAt: s.updatedAt,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      title: pair('सुधारित चाचणी', 'Updated test'),
      badge: pair('अंतिम संधी', 'Last chance'),
      deadline: '2028-02-29',
      link: 'https://example.gov.in/updated',
    });
    const cleared = (await patch(s.id, { badge: BLANK, deadline: null, link: null })).body.data as AdminScheme;
    expect(cleared).toMatchObject({ badge: BLANK, deadline: null, link: null, title: pair('सुधारित चाचणी', 'Updated test') });
    const pub = (await publicCards()).find((c) => c.id === s.id);
    expect(pub).toMatchObject({ badge: null, deadline: null, link: null });
    s = await get(s.id);
  });

  it('refuses a save over a newer version, and changes nothing', async () => {
    const res = await patch(s.id, { featured: true, expectedUpdatedAt: '2020-01-01T00:00:00.000Z' });
    expect(res.status).toBe(409);
    expect(await get(s.id)).toEqual(s);
  });

  it('refuses retitling a scheme to another scheme’s title', async () => {
    expect((await patch(s.id, { title: pair('ड्रोन पायलट प्रशिक्षण योजना', 'Different') })).status).toBe(409);
  });

  it('keeps the saved scheme when the database save fails', async () => {
    jest.spyOn(auditService, 'recordInTx').mockRejectedValueOnce(new Error('simulated database failure'));
    const res = await patch(s.id, { title: pair('टिकू नये', 'Must not stick'), deadline: '2029-01-01' });
    expect(res.status).toBe(500);
    expect(await get(s.id)).toEqual(s);
  });

  it('keeps the saved scheme when an invalid edit is refused', async () => {
    expect((await patch(s.id, { title: pair('', ''), deadline: '2026-02-30' })).status).toBe(422);
    expect(await get(s.id)).toEqual(s);
  });

  it('a hidden scheme leaves the website and comes back when shown', async () => {
    await request(app).patch(`${ADMIN_URL}/${s.id}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);
    expect((await publicCards()).map((c) => c.id)).not.toContain(s.id);
    await request(app).patch(`${ADMIN_URL}/${s.id}/status`).set(auth(admin.token)).send({ isActive: true }).expect(200);
    expect((await publicCards()).map((c) => c.id)).toContain(s.id);
  });
});

describe('Deleting and ordering', () => {
  it('deletes only the chosen scheme: soft-deleted, gone from the website, the rest untouched', async () => {
    const s = (await create(scheme(20)).expect(201)).body.data as AdminScheme;
    const others = (await list()).filter((x) => x.id !== s.id);
    const res = await request(app).delete(`${ADMIN_URL}/${s.id}`).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Scheme deleted successfully');
    expect(await list()).toEqual(others);
    expect((await publicCards()).map((c) => c.id)).not.toContain(s.id);
    const [row] = await AppDataSource.query(`SELECT "isDelete", "isActive" FROM "amrut_schemes" WHERE "id" = $1`, [s.id]);
    expect(row).toEqual({ isDelete: true, isActive: false });
    expect((await request(app).delete(`${ADMIN_URL}/${s.id}`).set(auth(admin.token))).status).toBe(404);
    /* The title is free again once the scheme is deleted. */
    expect((await create(scheme(20))).status).toBe(201);
  });

  it('reorders by id and refuses a stale or duplicated list', async () => {
    const ids = (await list()).map((r) => r.id);
    const reversed = [...ids].reverse();
    const res = await request(app).put(`${ADMIN_URL}/order`).set(auth(admin.token)).send({ ids: reversed });
    expect(res.status).toBe(200);
    expect((res.body.data as AdminScheme[]).map((r) => [r.id, r.displayOrder])).toEqual(reversed.map((id, i) => [id, i + 1]));
    expect((await publicCards()).map((c) => c.id)).toEqual(reversed);
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
          .send({ ids: [ids[0], ids[0]] })
      ).status,
    ).toBe(422);
  });
});

describe('Section settings', () => {
  const put = (payload: unknown) =>
    request(app)
      .put(`${ADMIN_URL}/settings`)
      .set(auth(admin.token))
      .send(payload as object);

  it('updates heading, subtitle and default button label, and can hide the section', async () => {
    const current = (await request(app).get(`${ADMIN_URL}/settings`).set(auth(admin.token)).expect(200)).body.data;
    const res = await put({
      heading: pair('नवीन शीर्षक', 'New heading'),
      subtitle: BLANK,
      buttonLabel: pair('पुढे वाचा', 'Read on'),
      showSection: true,
      expectedUpdatedAt: current.updatedAt,
    });
    expect(res.status).toBe(200);
    const pub = (await request(app).get(PUBLIC_URL)).body.data;
    expect(pub).toMatchObject({ heading: pair('नवीन शीर्षक', 'New heading'), subtitle: null, showSection: true });
    const labels = (pub.schemes as { buttonLabel: Pair }[]).map((c) => c.buttonLabel.en);
    expect(labels.filter((l) => l === 'Read on')).toHaveLength(labels.filter((l) => l !== 'Apply').length);

    await put({ heading: pair('अ', 'A'), subtitle: BLANK, buttonLabel: DEFAULT_LABEL, showSection: false }).expect(200);
    expect((await request(app).get(PUBLIC_URL)).body.data).toMatchObject({ showSection: false, schemes: [] });
    /* Hiding the section keeps the schemes. */
    expect((await list()).length).toBeGreaterThan(6);
  });

  it('requires the heading and default button label, and refuses stale saves', async () => {
    const res = await put({ heading: BLANK, subtitle: pair('फक्त', ''), buttonLabel: BLANK, showSection: true });
    expect(res.status).toBe(422);
    expect(
      details(res)
        .map((d) => d.field)
        .sort(),
    ).toEqual(['body.buttonLabel.en', 'body.buttonLabel.mr', 'body.heading.en', 'body.heading.mr', 'body.subtitle.en']);
    const stale = await put({
      heading: pair('अ', 'A'),
      subtitle: BLANK,
      buttonLabel: DEFAULT_LABEL,
      showSection: true,
      expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
    });
    expect(stale.status).toBe(409);
  });
});

describe('Access control', () => {
  it('refuses every admin route without a session', async () => {
    expect((await request(app).get(ADMIN_URL)).status).toBe(401);
    expect((await request(app).post(ADMIN_URL).send(scheme(30))).status).toBe(401);
    expect((await request(app).put(`${ADMIN_URL}/settings`).send({})).status).toBe(401);
    expect((await request(app).delete(`${ADMIN_URL}/00000000-0000-4000-8000-000000000000`)).status).toBe(401);
  });

  it('a view-only administrator can read but not create, edit, reorder, change settings or delete', async () => {
    const viewer = await actorWith(['cms-schemes.view']);
    const [first] = await list();
    const V = auth(viewer.token);
    expect((await request(app).get(ADMIN_URL).set(V)).status).toBe(200);
    expect((await create(scheme(31), viewer.token)).status).toBe(403);
    expect((await request(app).patch(`${ADMIN_URL}/${first!.id}`).set(V).send({ featured: true })).status).toBe(403);
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
    const other = await actorWith(['cms-ecosystem.view', 'cms-ecosystem.update']);
    expect((await request(app).get(ADMIN_URL).set(auth(other.token))).status).toBe(403);
  });
});
