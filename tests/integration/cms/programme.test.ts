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
import { seedProgrammePage } from '../../../src/database/seeds/seed-programme-page';

const ADMIN_URL = `${API}/cms/programme`;
const PUBLIC_URL = `${API}/public/programme`;

let app: Express;
let admin: TestActor;

const pair = (mr: string, en: string) => ({ mr, en });
const validPayload = () => ({
  intro: pair('परिचय', 'Introduction'),
  objectives: [pair('उद्दिष्ट एक', 'Objective one'), pair('उद्दिष्ट दोन', 'Objective two')],
  methodology: [{ label: pair('पद्धत', 'Delivery mode'), value: pair('ई-लर्निंग', 'eLearning') }],
  assessment: [
    { component: pair('अंतर्गत', 'Internal'), min: 10, max: 25 },
    { component: pair('अंतिम', 'Final'), min: 20, max: 50 },
  ],
  assessmentNote: pair('AI प्रॉक्टर्ड', 'AI proctored'),
  certification: [pair('प्रमाणपत्र', 'Certificate')],
  trainingModes: {
    title: pair('पद्धती', 'Modes'),
    modes: [{ name: pair('ऑफलाइन', 'OFFLINE'), description: pair('केंद्रावर', 'At a centre') }],
    note: pair('एकच', 'Exactly one'),
  },
  facts: { idealMonths: 8, validityMonths: 18, securityDeposit: 2500, applyLeadDays: 45, partnerName: 'Partner Pvt Ltd' },
});
/* The fact sheet the seed writes, which is what the website showed before it was managed. */
const SEEDED_FACTS = {
  idealMonths: 6,
  validityMonths: 12,
  securityDeposit: 2000,
  applyLeadDays: 30,
  partnerName: 'SUMAGO INFOTECH PVT LTD',
};

/* resetData() truncates programme_page_settings, so this file re-seeds the singleton it edits. */
beforeAll(async () => {
  app = await setupTestApp();
  await seedProgrammePage(AppDataSource);
  admin = await superAdmin();
});
afterAll(teardownTestApp);

describe('Programme page seed', () => {
  it('seeds the content the website used to hardcode, in both languages', async () => {
    const res = await request(app).get(ADMIN_URL).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data.intro).toEqual(
      pair(
        'कौशल्यातील तफावत भरून काढून युवकांची रोजगारक्षमता व स्वयंरोजगारक्षमता वाढविणे.',
        'Bridging the skill deficit to enhance employability and self-employability of youth.',
      ),
    );
    expect(res.body.data.objectives).toHaveLength(5);
    expect(res.body.data.methodology.map((m: { label: { en: string } }) => m.label.en)).toEqual([
      'Delivery mode',
      'Pedagogy',
      'Learning path',
      'Content',
      'Paradigm',
    ]);
    expect(res.body.data.assessment.map((a: { min: number; max: number }) => [a.min, a.max])).toEqual([
      [10, 25],
      [10, 25],
      [20, 50],
    ]);
    expect(res.body.data.certification).toHaveLength(5);
    expect(res.body.data.trainingModes.modes.map((m: { name: { en: string } }) => m.name.en)).toEqual(['OFFLINE', 'ONLINE']);
    expect(res.body.data.trainingModes.note.en).toBe('A candidate is enrolled in exactly one mode. There is no combined track.');
    expect(res.body.data.facts).toEqual(SEEDED_FACTS);
    expect(res.body.data.isPublished).toBe(true);
    expect((await request(app).get(PUBLIC_URL)).body.data.facts).toEqual(SEEDED_FACTS);
  });

  it('never overwrites administrator edits on a later run', async () => {
    await request(app).put(ADMIN_URL).set(auth(admin.token)).send(validPayload()).expect(200);
    expect(await seedProgrammePage(AppDataSource)).toEqual({ created: false });
    const after = await request(app).get(ADMIN_URL).set(auth(admin.token));
    expect(after.body.data.intro.en).toBe('Introduction');
  });
});

describe('Programme page management', () => {
  it('replaces the page, audits it, and serves it publicly without ids', async () => {
    const res = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(validPayload());
    expect(res.status).toBe(200);
    const pub = await request(app).get(PUBLIC_URL);
    expect(pub.status).toBe(200);
    expect(pub.body.data).toEqual({ ...validPayload(), hiddenFacts: [] });
    const [row] = await AppDataSource.query(`SELECT count(*)::int AS n FROM "audit_logs" WHERE "action" = 'cms.programme-page.update'`);
    expect(row.n).toBeGreaterThan(0);
  });

  it('unpublishing makes the public feed return null (200), publishing restores it', async () => {
    await request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ isPublished: false }).expect(200);
    const hidden = await request(app).get(PUBLIC_URL);
    expect(hidden.status).toBe(200);
    expect(hidden.body.data).toBeNull();
    await request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ isPublished: true }).expect(200);
    expect((await request(app).get(PUBLIC_URL)).body.data).not.toBeNull();
  });

  it('requires both languages, at least one item per list, and min <= total', async () => {
    const bad = {
      ...validPayload(),
      intro: pair('', 'Intro'),
      objectives: [],
      assessment: [{ component: pair('अ', 'A'), min: 30, max: 25 }],
    };
    const res = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(bad);
    expect(res.status).toBe(422);
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['body.intro.mr', 'body.objectives', 'body.assessment.0.min']));
  });

  it('stores the fact sheet, returns it to the admin screen and serves it publicly', async () => {
    const facts = { idealMonths: 7, validityMonths: 24, securityDeposit: 3000, applyLeadDays: 15, partnerName: '  Another Partner  ' };
    const res = await request(app)
      .put(ADMIN_URL)
      .set(auth(admin.token))
      .send({ ...validPayload(), facts });
    expect(res.status).toBe(200);
    const stored = { ...facts, partnerName: 'Another Partner' };
    expect(res.body.data.facts).toEqual(stored);
    expect((await request(app).get(ADMIN_URL).set(auth(admin.token))).body.data.facts).toEqual(stored);
    expect((await request(app).get(PUBLIC_URL)).body.data.facts).toEqual(stored);
    /* Only the entered figures are stored; totals are summed from the modules by the site. */
    expect(Object.keys(res.body.data.facts).sort()).toEqual([
      'applyLeadDays',
      'idealMonths',
      'partnerName',
      'securityDeposit',
      'validityMonths',
    ]);
  });

  it('requires the fact sheet, with non-negative figures and a partner name', async () => {
    const { facts: _omitted, ...withoutFacts } = validPayload();
    const missing = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(withoutFacts);
    expect(missing.status).toBe(422);
    expect(missing.body.error.details.map((d: { field: string }) => d.field)).toContain('body.facts');

    const bad = { ...validPayload(), facts: { ...validPayload().facts, securityDeposit: -1, partnerName: '   ' } };
    const res = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(bad);
    expect(res.status).toBe(422);
    const details = res.body.error.details as { field: string; message: string }[];
    expect(details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'body.facts.securityDeposit', message: 'Security deposit cannot be negative' }),
        expect.objectContaining({ field: 'body.facts.partnerName', message: 'Partner name is required' }),
      ]),
    );

    const tooLarge = { ...validPayload(), facts: { ...validPayload().facts, idealMonths: 121, unknown: 1 } };
    const fields = (await request(app).put(ADMIN_URL).set(auth(admin.token)).send(tooLarge)).body.error.details.map(
      (d: { field: string }) => d.field,
    );
    expect(fields).toEqual(expect.arrayContaining(['body.facts.idealMonths', 'body.facts']));
  });

  it('enforces the CMS permissions', async () => {
    const viewer = await actorWith(['cms-programme.view']);
    expect((await request(app).get(ADMIN_URL).set(auth(viewer.token))).status).toBe(200);
    expect((await request(app).put(ADMIN_URL).set(auth(viewer.token)).send(validPayload())).status).toBe(403);
    expect((await request(app).get(ADMIN_URL)).status).toBe(401);
  });
});

describe('Fact sheet row switches', () => {
  /* Display order on the website. */
  const FACT_KEYS = ['totalHours', 'modules', 'electives', 'idealDuration', 'validity', 'securityDeposit', 'applyBefore', 'partner'];
  const setFact = (key: string, payload: unknown, token = admin.token) =>
    request(app)
      .patch(`${ADMIN_URL}/facts/${key}`)
      .set(auth(token))
      .send(payload as object);
  const adminHidden = async () => (await request(app).get(ADMIN_URL).set(auth(admin.token))).body.data.hiddenFacts;
  const publicHidden = async () => (await request(app).get(PUBLIC_URL)).body.data.hiddenFacts;
  const auditCount = async () =>
    (await AppDataSource.query(`SELECT count(*)::int AS n FROM "audit_logs" WHERE "action" = 'cms.programme.fact-visibility'`))[0]
      .n as number;

  it('starts with every row shown', async () => {
    expect(await adminHidden()).toEqual([]);
    expect(await publicHidden()).toEqual([]);
  });

  it('hides and shows each row, returns the admin page, and the public feed follows', async () => {
    /* Hidden back to front, still listed in display order. */
    for (const key of [...FACT_KEYS].reverse()) {
      const res = await setFact(key, { show: false });
      expect(res.status).toBe(200);
      expect(res.body.data.hiddenFacts).toContain(key);
      expect(res.body.data.facts).toBeDefined();
      expect(await publicHidden()).toContain(key);
    }
    expect(await adminHidden()).toEqual(FACT_KEYS);
    expect(await publicHidden()).toEqual(FACT_KEYS);

    for (const key of FACT_KEYS) {
      const res = await setFact(key, { show: true });
      expect(res.status).toBe(200);
      expect(res.body.data.hiddenFacts).not.toContain(key);
      expect(await publicHidden()).not.toContain(key);
    }
    expect(await publicHidden()).toEqual([]);
  });

  it('is idempotent, and audits every switch with the key and the value', async () => {
    const before = await auditCount();
    await setFact('partner', { show: false }).expect(200);
    const again = await setFact('partner', { show: false });
    expect(again.status).toBe(200);
    expect(again.body.data.hiddenFacts).toEqual(['partner']);
    expect(await auditCount()).toBe(before + 2);
    const [entry] = await AppDataSource.query(
      `SELECT "resource", "details", "actorUserId" FROM "audit_logs"
        WHERE "action" = 'cms.programme.fact-visibility' ORDER BY "createdAt" DESC LIMIT 1`,
    );
    expect(entry).toEqual({ resource: 'programme-page', actorUserId: admin.user.id, details: { key: 'partner', show: false } });

    await setFact('partner', { show: true }).expect(200);
    expect((await setFact('partner', { show: true })).body.data.hiddenFacts).toEqual([]);
  });

  it('is kept by the full-page save, which cannot set it', async () => {
    await setFact('validity', { show: false }).expect(200);
    const saved = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(validPayload());
    expect(saved.status).toBe(200);
    expect(saved.body.data.hiddenFacts).toEqual(['validity']);
    expect(await publicHidden()).toEqual(['validity']);

    const smuggled = await request(app)
      .put(ADMIN_URL)
      .set(auth(admin.token))
      .send({ ...validPayload(), hiddenFacts: [] });
    expect(smuggled.status).toBe(422);
    expect(await adminHidden()).toEqual(['validity']);

    await setFact('validity', { show: true }).expect(200);
  });

  it('needs cms-programme.update', async () => {
    const viewer = await actorWith(['cms-programme.view']);
    expect((await setFact('partner', { show: false }, viewer.token)).status).toBe(403);
    expect((await request(app).patch(`${ADMIN_URL}/facts/partner`).send({ show: false })).status).toBe(401);
    expect(await adminHidden()).toEqual([]);

    const editor = await actorWith(['cms-programme.view', 'cms-programme.update']);
    expect((await setFact('partner', { show: false }, editor.token)).status).toBe(200);
    await setFact('partner', { show: true }).expect(200);
  });

  it('rejects an unknown row and a bad body with 422', async () => {
    const fields = async (key: string, payload: unknown) => {
      const res = await setFact(key, payload);
      expect(res.status).toBe(422);
      return res.body.error.details.map((d: { field: string }) => d.field);
    };
    expect(await fields('bogus', { show: false })).toEqual(['params.key']);
    expect(await fields('partner', {})).toEqual(['body.show']);
    expect(await fields('partner', { show: 'no' })).toEqual(['body.show']);
    expect(await fields('partner', { show: false, key: 'modules' })).toEqual(['body']);
    expect(await adminHidden()).toEqual([]);
  });

  it('is a 404 while the page is not configured', async () => {
    await AppDataSource.query(`UPDATE "programme_page_settings" SET "isDelete" = true WHERE "isDelete" = false`);
    try {
      const res = await setFact('partner', { show: false });
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('The Programme page has not been configured yet. Run the database seed to create it.');
    } finally {
      await AppDataSource.query(
        `UPDATE "programme_page_settings" SET "isDelete" = false
          WHERE "id" = (SELECT "id" FROM "programme_page_settings" ORDER BY "createdAt" DESC LIMIT 1)`,
      );
    }
    expect(await adminHidden()).toEqual([]);
  });

  it('the database admits only the row keys', async () => {
    await expect(AppDataSource.query(`UPDATE "programme_page_settings" SET "hiddenFacts" = ARRAY['bogus']`)).rejects.toThrow(
      /CHK_programme_page_settings_hidden_facts/,
    );
    await expect(AppDataSource.query(`UPDATE "programme_page_settings" SET "hiddenFacts" = ARRAY['partner', NULL]`)).rejects.toThrow(
      /CHK_programme_page_settings_hidden_facts/,
    );
  });
});
