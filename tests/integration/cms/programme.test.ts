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
import type { QueryRunner } from 'typeorm';
import { seedProgrammePage } from '../../../src/database/seeds/seed-programme-page';
import { ProgrammeMonthRanges1797700000000 } from '../../../src/database/migrations/1797700000000-ProgrammeMonthRanges';

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
  facts: { idealMonths: '8', validityMonths: '12-18', securityDeposit: 2500, applyLeadDays: 45, partnerName: 'Partner Pvt Ltd' },
});
/* The fact sheet the seed writes, which is what the website showed before it was managed. */
const SEEDED_FACTS = {
  idealMonths: '6',
  validityMonths: '12',
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
    const facts = {
      idealMonths: '4-6',
      validityMonths: '24',
      securityDeposit: 3000,
      applyLeadDays: 15,
      partnerName: '  Another Partner  ',
    };
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

describe('Fact sheet durations (a number of months or a range)', () => {
  const putFacts = (facts: Record<string, unknown>) =>
    request(app)
      .put(ADMIN_URL)
      .set(auth(admin.token))
      .send({ ...validPayload(), facts: { ...validPayload().facts, ...facts } });
  /* The stored pair, as the admin screen and the public feed both return it. */
  const stored = async () => {
    const adminFacts = (await request(app).get(ADMIN_URL).set(auth(admin.token))).body.data.facts;
    const publicFacts = (await request(app).get(PUBLIC_URL)).body.data.facts;
    expect(publicFacts).toEqual(adminFacts);
    return [adminFacts.idealMonths, adminFacts.validityMonths];
  };
  /* The 422's messages for the two fields, after checking nothing was written. */
  const rejected = async (facts: Record<string, unknown>) => {
    const before = await stored();
    const res = await putFacts(facts);
    expect(res.status).toBe(422);
    expect(await stored()).toEqual(before);
    return (res.body.error.details as { field: string; message: string }[])
      .filter((d) => d.field === 'body.facts.idealMonths' || d.field === 'body.facts.validityMonths')
      .map((d) => `${d.field.slice('body.facts.'.length)}: ${d.message}`);
  };
  const INVALID_IDEAL = 'idealMonths: Ideal duration must be a number of months or a range such as 4-6';

  it('stores a single number and a range as given', async () => {
    const res = await putFacts({ idealMonths: '6', validityMonths: '6-12' });
    expect(res.status).toBe(200);
    expect([res.body.data.facts.idealMonths, res.body.data.facts.validityMonths]).toEqual(['6', '6-12']);
    expect(await stored()).toEqual(['6', '6-12']);

    await putFacts({ idealMonths: '4-6', validityMonths: '12' }).expect(200);
    expect(await stored()).toEqual(['4-6', '12']);
  });

  it('normalises spaces and an en or em dash to "N-M"', async () => {
    const cases: [string, string][] = [
      ['4 - 6', '4-6'],
      [' 4–6 ', '4-6'],
      ['4 – 6', '4-6'],
      ['10—12', '10-12'],
      ['  7  ', '7'],
    ];
    for (const [given, normalised] of cases) {
      const res = await putFacts({ idealMonths: given, validityMonths: given });
      expect(res.status).toBe(200);
      expect([res.body.data.facts.idealMonths, res.body.data.facts.validityMonths]).toEqual([normalised, normalised]);
      expect(await stored()).toEqual([normalised, normalised]);
    }
  });

  it('accepts the bounds of each field', async () => {
    await putFacts({ idealMonths: '0', validityMonths: '0' }).expect(200);
    expect(await stored()).toEqual(['0', '0']);
    await putFacts({ idealMonths: '0-120', validityMonths: '239-240' }).expect(200);
    expect(await stored()).toEqual(['0-120', '239-240']);
    await putFacts({ idealMonths: '120', validityMonths: '240' }).expect(200);
    expect(await stored()).toEqual(['120', '240']);
  });

  it('still accepts a JSON number from an older admin screen, as its string form', async () => {
    const res = await putFacts({ idealMonths: 5, validityMonths: 18 });
    expect(res.status).toBe(200);
    expect(res.body.data.facts).toEqual(expect.objectContaining({ idealMonths: '5', validityMonths: '18' }));
    expect(await stored()).toEqual(['5', '18']);
    expect(await rejected({ idealMonths: 121, validityMonths: 241 })).toEqual([
      'idealMonths: Ideal duration is too large',
      'validityMonths: Validity is too large',
    ]);
    expect(await rejected({ idealMonths: 4.5, validityMonths: -1 })).toEqual([
      INVALID_IDEAL,
      'validityMonths: Validity must be a number of months or a range such as 4-6',
    ]);
  });

  it('rejects a range written larger number first, or from a number to itself', async () => {
    await putFacts({ idealMonths: '6', validityMonths: '12' }).expect(200);
    expect(await rejected({ idealMonths: '6-4', validityMonths: '12-12' })).toEqual([
      'idealMonths: Ideal duration: enter the smaller number first, e.g. 4-6',
      'validityMonths: Validity: enter the smaller number first, e.g. 4-6',
    ]);
    expect(await rejected({ idealMonths: '4–4' })).toEqual(['idealMonths: Ideal duration: enter the smaller number first, e.g. 4-6']);
  });

  it('rejects a number over the field maximum, on either side of a range', async () => {
    expect(await rejected({ idealMonths: '121', validityMonths: '241' })).toEqual([
      'idealMonths: Ideal duration is too large',
      'validityMonths: Validity is too large',
    ]);
    expect(await rejected({ idealMonths: '4-121', validityMonths: '241-300' })).toEqual([
      'idealMonths: Ideal duration is too large',
      'validityMonths: Validity is too large',
    ]);
    expect(await rejected({ idealMonths: '99999999999999999999' })).toEqual(['idealMonths: Ideal duration is too large']);
  });

  it('rejects leading zeros (other than 0 itself)', async () => {
    for (const value of ['04-6', '4-06', '06', '00', ' 04-6 ']) {
      expect(await rejected({ idealMonths: value })).toEqual([INVALID_IDEAL]);
    }
  });

  it('rejects anything else that is not a number of months or a range', async () => {
    const notMonths = ['', '   ', 'six', '4-', '-4', '4--6', '4-6-8', '4.5', '4 to 6', '4~6', '4/6', '+4', '٤-٦', null, true, ['4', '6']];
    for (const value of notMonths) {
      expect(await rejected({ idealMonths: value })).toEqual([INVALID_IDEAL]);
    }
    const { idealMonths: _omitted, ...withoutIdeal } = validPayload().facts;
    const missing = await request(app)
      .put(ADMIN_URL)
      .set(auth(admin.token))
      .send({ ...validPayload(), facts: withoutIdeal });
    expect(missing.status).toBe(422);
    expect(missing.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'body.facts.idealMonths', message: 'Ideal duration is required' })]),
    );
  });

  it('the database admits only the normalised form', async () => {
    for (const value of ['4 - 6', '4–6', '04', '4-06', '', '1000', 'six']) {
      await expect(AppDataSource.query(`UPDATE "programme_page_settings" SET "idealMonths" = $1`, [value])).rejects.toThrow(
        /CHK_programme_page_settings_ideal_months/,
      );
      await expect(AppDataSource.query(`UPDATE "programme_page_settings" SET "validityMonths" = $1`, [value])).rejects.toThrow(
        /CHK_programme_page_settings_validity_months/,
      );
    }
    await expect(AppDataSource.query(`UPDATE "programme_page_settings" SET "securityDeposit" = -1`)).rejects.toThrow(
      /CHK_programme_page_settings_facts/,
    );
    await AppDataSource.query(`UPDATE "programme_page_settings" SET "idealMonths" = '4-6', "validityMonths" = '12'`);
    expect(await stored()).toEqual(['4-6', '12']);
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

describe('migration 1797700000000', () => {
  /* Runs one statement under a savepoint and reports the PostgreSQL error code, or null when it succeeded. */
  const attempt = async (qr: QueryRunner, sql: string): Promise<string | null> => {
    await qr.query('SAVEPOINT attempt');
    try {
      await qr.query(sql);
      return null;
    } catch (e) {
      const err = e as { code?: string; driverError?: { code?: string } };
      return err.driverError?.code ?? err.code ?? 'unknown';
    } finally {
      await qr.query('ROLLBACK TO SAVEPOINT attempt');
    }
  };
  const columns = (qr: QueryRunner) =>
    qr.query(
      `SELECT "column_name", "data_type", "character_maximum_length" AS "length", "column_default" AS "default"
         FROM information_schema.columns
        WHERE table_name = 'programme_page_settings' AND column_name IN ('idealMonths', 'validityMonths')
        ORDER BY column_name`,
    );
  const values = async (qr: QueryRunner) =>
    (await qr.query(`SELECT "idealMonths", "validityMonths" FROM "programme_page_settings" WHERE "isDelete" = false`))[0];

  /*
   * Runs down() then up() inside a transaction that is always rolled back, so the shared test
   * schema is left exactly as the migrations built it whatever happens here.
   */
  it('turns the months into text and back (down keeps the first number of a range)', async () => {
    const migration = new ProgrammeMonthRanges1797700000000();
    const qr = AppDataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await qr.query(`UPDATE "programme_page_settings" SET "idealMonths" = '4-6', "validityMonths" = '12'`);

      await migration.down(qr);
      expect(await columns(qr)).toEqual([
        { column_name: 'idealMonths', data_type: 'integer', length: null, default: '6' },
        { column_name: 'validityMonths', data_type: 'integer', length: null, default: '12' },
      ]);
      /* Lossy by design: "4-6" became 4. */
      expect(await values(qr)).toEqual({ idealMonths: 4, validityMonths: 12 });
      expect(await attempt(qr, `UPDATE "programme_page_settings" SET "idealMonths" = -1`)).toBe('23514');
      expect(await attempt(qr, `UPDATE "programme_page_settings" SET "securityDeposit" = -1`)).toBe('23514');

      await qr.query(`UPDATE "programme_page_settings" SET "idealMonths" = 8, "validityMonths" = 18`);
      await migration.up(qr);
      expect(await columns(qr)).toEqual([
        { column_name: 'idealMonths', data_type: 'character varying', length: 7, default: "'6'::character varying" },
        { column_name: 'validityMonths', data_type: 'character varying', length: 7, default: "'12'::character varying" },
      ]);
      /* Each number carried over as its text. */
      expect(await values(qr)).toEqual({ idealMonths: '8', validityMonths: '18' });
      expect(await attempt(qr, `UPDATE "programme_page_settings" SET "idealMonths" = '4-6', "validityMonths" = '240-240'`)).toBeNull();
      expect(await attempt(qr, `UPDATE "programme_page_settings" SET "idealMonths" = '4 - 6'`)).toBe('23514');
      expect(await attempt(qr, `UPDATE "programme_page_settings" SET "validityMonths" = '012'`)).toBe('23514');
      expect(await attempt(qr, `UPDATE "programme_page_settings" SET "applyLeadDays" = -1`)).toBe('23514');
    } finally {
      await qr.rollbackTransaction();
      await qr.release();
    }
  });
});
