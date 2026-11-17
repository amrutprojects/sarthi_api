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
import { seedProgrammeHighlight } from '../../../src/database/seeds/seed-programme-highlight';

/*
 * Home Page Management → "Skill Development Diploma": the per-row show/hide switches of the fact table
 * beside the band. programme_highlight is kept between test files (KEEP_ON_RESET), so every test here
 * leaves the switches as it found them: every row shown, the band published.
 */
const ADMIN_URL = `${API}/cms/highlight`;
const PUBLIC_URL = `${API}/public/highlight`;
/* Display order on the website. */
const ROW_KEYS = [
  'totalDuration',
  'idealCompletion',
  'candidatureValidity',
  'perModule',
  'schedule',
  'securityDeposit',
  'certification',
];

let app: Express;
let admin: TestActor;

const setRow = (key: string, payload: unknown, token = admin.token) =>
  request(app)
    .patch(`${ADMIN_URL}/rows/${key}`)
    .set(auth(token))
    .send(payload as object);
const adminData = async () => (await request(app).get(ADMIN_URL).set(auth(admin.token)).expect(200)).body.data;
const adminHidden = async () => (await adminData()).hiddenRows;
const publicHidden = async () => (await request(app).get(PUBLIC_URL).expect(200)).body.data.hiddenRows;
const auditCount = async () =>
  (await AppDataSource.query(`SELECT count(*)::int AS n FROM "audit_logs" WHERE "action" = 'cms.highlight.row-visibility'`))[0]
    .n as number;

/* The full-section PUT body the admin edit form sends, built from the section as it is now. */
const currentPutBody = async () => {
  const d = await adminData();
  return {
    heading: d.heading,
    subheading: d.subheading,
    tagline: d.tagline,
    certification: d.certification,
    objectives: d.objectives.map((o: { text: unknown; displayOrder: number; isActive: boolean }) => ({
      text: o.text,
      displayOrder: o.displayOrder,
      isActive: o.isActive,
    })),
  };
};

beforeAll(async () => {
  app = await setupTestApp();
  await seedProgrammeHighlight(AppDataSource);
  await AppDataSource.query(
    `UPDATE "programme_highlight" SET "hiddenRows" = '{}', "rowLabels" = '{}'::jsonb, "isPublished" = true WHERE "isDelete" = false`,
  );
  admin = await superAdmin();
});
afterAll(async () => {
  await AppDataSource.query(`UPDATE "programme_highlight" SET "hiddenRows" = '{}', "rowLabels" = '{}'::jsonb WHERE "isDelete" = false`);
  await teardownTestApp();
});

describe('Diploma fact table row switches', () => {
  it('starts with every row shown, in the admin read and the public feed', async () => {
    expect(await adminHidden()).toEqual([]);
    expect(await publicHidden()).toEqual([]);
  });

  it('hides and shows each row, returns the admin section, and the public feed follows', async () => {
    /* Hidden back to front, still listed in display order. */
    for (const key of [...ROW_KEYS].reverse()) {
      const res = await setRow(key, { show: false });
      expect(res.status).toBe(200);
      expect(res.body.data.hiddenRows).toContain(key);
      expect(res.body.data.heading).toBeDefined();
      expect(res.body.data.objectives).toBeDefined();
      expect(await publicHidden()).toContain(key);
    }
    expect(await adminHidden()).toEqual(ROW_KEYS);
    expect(await publicHidden()).toEqual(ROW_KEYS);

    for (const key of ROW_KEYS) {
      const res = await setRow(key, { show: true });
      expect(res.status).toBe(200);
      expect(res.body.data.hiddenRows).not.toContain(key);
      expect(await publicHidden()).not.toContain(key);
    }
    expect(await publicHidden()).toEqual([]);
  });

  it('is sent in the public feed also while the band is hidden', async () => {
    await setRow('securityDeposit', { show: false }).expect(200);
    await request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ isPublished: false }).expect(200);
    try {
      const res = await request(app).get(PUBLIC_URL).expect(200);
      expect(res.body.data.showSection).toBe(false);
      expect(res.body.data.hiddenRows).toEqual(['securityDeposit']);
    } finally {
      await request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ isPublished: true }).expect(200);
      await setRow('securityDeposit', { show: true }).expect(200);
    }
  });

  it('is idempotent, and audits every switch with the key and the value', async () => {
    const before = await auditCount();
    await setRow('schedule', { show: false }).expect(200);
    const again = await setRow('schedule', { show: false });
    expect(again.status).toBe(200);
    expect(again.body.data.hiddenRows).toEqual(['schedule']);
    expect(await auditCount()).toBe(before + 2);
    const [entry] = await AppDataSource.query(
      `SELECT "resource", "details", "actorUserId" FROM "audit_logs"
        WHERE "action" = 'cms.highlight.row-visibility' ORDER BY "createdAt" DESC LIMIT 1`,
    );
    expect(entry).toEqual({ resource: 'programme-highlight', actorUserId: admin.user.id, details: { key: 'schedule', show: false } });

    await setRow('schedule', { show: true }).expect(200);
    expect((await setRow('schedule', { show: true })).body.data.hiddenRows).toEqual([]);
  });

  it('is kept by the full-section save, which cannot set it', async () => {
    await setRow('certification', { show: false }).expect(200);
    const body = await currentPutBody();
    const saved = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(body);
    expect(saved.status).toBe(200);
    expect(saved.body.data.hiddenRows).toEqual(['certification']);
    expect(await publicHidden()).toEqual(['certification']);

    const smuggled = await request(app)
      .put(ADMIN_URL)
      .set(auth(admin.token))
      .send({ ...body, hiddenRows: [] });
    expect(smuggled.status).toBe(422);
    expect(await adminHidden()).toEqual(['certification']);

    await setRow('certification', { show: true }).expect(200);
  });

  it('needs cms-highlight.update', async () => {
    const viewer = await actorWith(['cms-highlight.view']);
    expect((await request(app).get(ADMIN_URL).set(auth(viewer.token))).body.data.hiddenRows).toEqual([]);
    expect((await setRow('perModule', { show: false }, viewer.token)).status).toBe(403);
    expect((await request(app).patch(`${ADMIN_URL}/rows/perModule`).send({ show: false })).status).toBe(401);
    expect(await adminHidden()).toEqual([]);

    const editor = await actorWith(['cms-highlight.view', 'cms-highlight.update']);
    expect((await setRow('perModule', { show: false }, editor.token)).status).toBe(200);
    await setRow('perModule', { show: true }).expect(200);
  });

  it('rejects an unknown row and a bad body with 422', async () => {
    const fields = async (key: string, payload: unknown) => {
      const res = await setRow(key, payload);
      expect(res.status).toBe(422);
      return res.body.error.details.map((d: { field: string }) => d.field);
    };
    expect(await fields('bogus', { show: false })).toEqual(['params.key']);
    /* A Programme fact sheet key is not a row of this table. */
    expect(await fields('partner', { show: false })).toEqual(['params.key']);
    /* Show, label or both: an empty body changes nothing, so it is refused. */
    expect(await fields('schedule', {})).toEqual(['body']);
    expect(await fields('schedule', { show: 'no' })).toEqual(['body.show']);
    expect(await fields('schedule', { show: false, key: 'perModule' })).toEqual(['body']);
    expect(await adminHidden()).toEqual([]);
  });

  it('does not shadow, and is not shadowed by, PATCH /status', async () => {
    const status = await request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ show: false });
    expect(status.status).toBe(422);
    expect((await request(app).patch(`${ADMIN_URL}/rows`).set(auth(admin.token)).send({ show: false })).status).toBe(404);
    expect(await adminHidden()).toEqual([]);
  });

  it('is a 404 while the section is not configured', async () => {
    const { id } = await adminData();
    await AppDataSource.query(`UPDATE "programme_highlight" SET "isDelete" = true WHERE "id" = $1`, [id]);
    try {
      const res = await setRow('schedule', { show: false });
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('The home programme section has not been configured yet. Run the database seed to create it.');
    } finally {
      await AppDataSource.query(`UPDATE "programme_highlight" SET "isDelete" = false WHERE "id" = $1`, [id]);
    }
    expect(await adminHidden()).toEqual([]);
  });

  it('the database admits only the row keys', async () => {
    await expect(AppDataSource.query(`UPDATE "programme_highlight" SET "hiddenRows" = ARRAY['bogus']`)).rejects.toThrow(
      /CHK_programme_highlight_hidden_rows/,
    );
    await expect(AppDataSource.query(`UPDATE "programme_highlight" SET "hiddenRows" = ARRAY['schedule', NULL]`)).rejects.toThrow(
      /CHK_programme_highlight_hidden_rows/,
    );
  });
});

/*
 * The custom name of each fact table row (PATCH /rows/:key with `label`). Every test leaves the names as it found
 * them: none set, so every row keeps the website's default name.
 */
describe('Diploma fact table row names', () => {
  type Label = { mr: string; en: string };
  const adminLabels = async () => (await adminData()).rowLabels as Record<string, Label>;
  const publicLabels = async () => (await request(app).get(PUBLIC_URL).expect(200)).body.data.rowLabels as Record<string, Label>;
  const stored = async () =>
    (await AppDataSource.query(`SELECT "rowLabels" FROM "programme_highlight" WHERE "isDelete" = false`))[0].rowLabels as unknown;
  const lastAudit = async () =>
    (
      await AppDataSource.query(
        `SELECT "details" FROM "audit_logs" WHERE "action" = 'cms.highlight.row-visibility' ORDER BY "createdAt" DESC LIMIT 1`,
      )
    )[0].details as unknown;
  const details = (res: { body: { error: { details: { field: string; message: string }[] } } }) =>
    res.body.error.details.map(({ field, message }) => ({ field, message }));

  const DURATION: Label = { mr: 'एकूण तास', en: 'Total hours' };

  afterEach(async () => {
    await AppDataSource.query(`UPDATE "programme_highlight" SET "hiddenRows" = '{}', "rowLabels" = '{}'::jsonb WHERE "isDelete" = false`);
  });

  it('starts with no custom name, in the admin read and the public feed', async () => {
    expect(await adminLabels()).toEqual({});
    expect(await publicLabels()).toEqual({});
  });

  it('sets a name (trimmed), returns the admin section, and the public feed follows; null resets it', async () => {
    const res = await setRow('totalDuration', { label: { mr: `  ${DURATION.mr} `, en: ` ${DURATION.en}  ` } });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Row name saved');
    expect(res.body.data.rowLabels).toEqual({ totalDuration: DURATION });
    expect(res.body.data.hiddenRows).toEqual([]);
    expect(res.body.data.heading).toBeDefined();
    expect(await adminLabels()).toEqual({ totalDuration: DURATION });
    expect(await publicLabels()).toEqual({ totalDuration: DURATION });
    expect(await stored()).toEqual({ totalDuration: DURATION });

    await setRow('certification', { label: { mr: 'प्रमाणन', en: 'Certificate' } }).expect(200);
    expect(await publicLabels()).toEqual({ totalDuration: DURATION, certification: { mr: 'प्रमाणन', en: 'Certificate' } });

    const reset = await setRow('totalDuration', { label: null });
    expect(reset.status).toBe(200);
    expect(reset.body.message).toBe('Row name reset to the default');
    expect(reset.body.data.rowLabels).toEqual({ certification: { mr: 'प्रमाणन', en: 'Certificate' } });
    expect(await publicLabels()).toEqual({ certification: { mr: 'प्रमाणन', en: 'Certificate' } });
    /* Only customised rows are stored. */
    expect(await stored()).toEqual({ certification: { mr: 'प्रमाणन', en: 'Certificate' } });
  });

  it('resets when both halves are blank, and collapses line breaks into one line', async () => {
    await setRow('schedule', { label: { mr: 'वेळ', en: 'Timing' } }).expect(200);
    const blank = await setRow('schedule', { label: { mr: '   ', en: '' } });
    expect(blank.status).toBe(200);
    expect(blank.body.data.rowLabels).toEqual({});

    const multi = await setRow('schedule', { label: { mr: 'वर्ग\nवेळ', en: 'Class\r\n\ttiming' } });
    expect(multi.status).toBe(200);
    expect(multi.body.data.rowLabels).toEqual({ schedule: { mr: 'वर्ग वेळ', en: 'Class timing' } });

    const longest = { mr: 'अ'.repeat(40), en: 'x'.repeat(40) };
    expect((await setRow('schedule', { label: longest }).expect(200)).body.data.rowLabels).toEqual({ schedule: longest });
  });

  it('changes only what the body names: the switch and the name are independent', async () => {
    await setRow('perModule', { label: { mr: 'मॉड्यूलनुसार', en: 'Each module' } }).expect(200);
    const hidden = await setRow('perModule', { show: false });
    expect(hidden.body.data.hiddenRows).toEqual(['perModule']);
    expect(hidden.body.data.rowLabels).toEqual({ perModule: { mr: 'मॉड्यूलनुसार', en: 'Each module' } });

    const renamed = await setRow('perModule', { label: { mr: 'प्रत्येक मॉड्यूल', en: 'Per unit' } });
    expect(renamed.body.data.hiddenRows).toEqual(['perModule']);
    expect(renamed.body.data.rowLabels).toEqual({ perModule: { mr: 'प्रत्येक मॉड्यूल', en: 'Per unit' } });

    const both = await setRow('perModule', { show: true, label: null });
    expect(both.status).toBe(200);
    expect(both.body.message).toBe('Row updated');
    expect(both.body.data.hiddenRows).toEqual([]);
    expect(both.body.data.rowLabels).toEqual({});
  });

  it('is idempotent, and audits every change with the key and what changed (label null on reset)', async () => {
    const name = { mr: 'अनामत', en: 'Deposit' };
    const first = (await setRow('securityDeposit', { label: name }).expect(200)).body.data;
    expect(await lastAudit()).toEqual({ key: 'securityDeposit', label: name });
    const before = await auditCount();
    const again = (await setRow('securityDeposit', { label: { mr: ` ${name.mr}`, en: name.en } }).expect(200)).body.data;
    expect(again.rowLabels).toEqual({ securityDeposit: name });
    /* Nothing written the second time, but still audited. */
    expect(again.updatedAt).toBe(first.updatedAt);
    expect(await auditCount()).toBe(before + 1);

    await setRow('securityDeposit', { show: false, label: null }).expect(200);
    expect(await lastAudit()).toEqual({ key: 'securityDeposit', show: false, label: null });
    /* Resetting a row that has no custom name writes nothing. */
    const unchanged = (await setRow('securityDeposit', { label: null }).expect(200)).body.data;
    expect((await setRow('securityDeposit', { label: { mr: '', en: ' ' } }).expect(200)).body.data.updatedAt).toBe(unchanged.updatedAt);
    expect(await lastAudit()).toEqual({ key: 'securityDeposit', label: null });
  });

  it('rejects a half, too long or control-character name, and a bad body, with 422 naming the field', async () => {
    const enMissing = await setRow('idealCompletion', { label: { mr: 'आदर्श', en: '  ' } });
    expect(enMissing.status).toBe(422);
    expect(details(enMissing)).toEqual([{ field: 'body.label.en', message: 'Name (English) is required when the Marathi text is filled in' }]);

    const mrMissing = await setRow('idealCompletion', { label: { mr: '', en: 'Ideal' } });
    expect(mrMissing.status).toBe(422);
    expect(details(mrMissing)).toEqual([{ field: 'body.label.mr', message: 'Name (Marathi) is required when the English text is filled in' }]);

    const tooLong = await setRow('idealCompletion', { label: { mr: 'अ'.repeat(41), en: 'x'.repeat(41) } });
    expect(tooLong.status).toBe(422);
    expect(details(tooLong)).toEqual([
      { field: 'body.label.mr', message: 'Name (Marathi) must be at most 40 characters' },
      { field: 'body.label.en', message: 'Name (English) must be at most 40 characters' },
    ]);

    const control = await setRow('idealCompletion', { label: { mr: 'आदर्श\u0007', en: 'Ideal' } });
    expect(control.status).toBe(422);
    expect(details(control)).toEqual([{ field: 'body.label.mr', message: 'Name (Marathi) contains characters that are not allowed' }]);

    const notPair = await setRow('idealCompletion', { label: 'Ideal' });
    expect(notPair.status).toBe(422);
    expect(details(notPair)).toEqual([{ field: 'body.label', message: 'Name must have Marathi and English text' }]);

    const extra = await setRow('idealCompletion', { label: { mr: 'आदर्श', en: 'Ideal', hi: 'x' } });
    expect(extra.status).toBe(422);
    expect(details(extra).map((d: { field: string }) => d.field)).toEqual(['body.label']);

    const badShow = await setRow('idealCompletion', { show: 'no', label: { mr: 'आदर्श', en: 'Ideal' } });
    expect(badShow.status).toBe(422);
    expect(details(badShow).map((d: { field: string }) => d.field)).toEqual(['body.show']);

    const unknownRow = await setRow('partner', { label: { mr: 'भागीदार', en: 'Partner' } });
    expect(unknownRow.status).toBe(422);
    expect(details(unknownRow).map((d: { field: string }) => d.field)).toEqual(['params.key']);

    const empty = await setRow('idealCompletion', {});
    expect(empty.status).toBe(422);
    expect(details(empty)).toEqual([{ field: 'body', message: 'Send show, label or both' }]);

    expect(await adminLabels()).toEqual({});
    expect(await adminHidden()).toEqual([]);
  });

  it('is kept by the full-section save, which cannot set it', async () => {
    await setRow('candidatureValidity', { label: { mr: 'वैधता', en: 'Validity' } }).expect(200);
    const body = await currentPutBody();
    const saved = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(body);
    expect(saved.status).toBe(200);
    expect(saved.body.data.rowLabels).toEqual({ candidatureValidity: { mr: 'वैधता', en: 'Validity' } });

    const smuggled = await request(app)
      .put(ADMIN_URL)
      .set(auth(admin.token))
      .send({ ...body, rowLabels: {} });
    expect(smuggled.status).toBe(422);
    expect(await publicLabels()).toEqual({ candidatureValidity: { mr: 'वैधता', en: 'Validity' } });
  });

  it('is sent in the public feed also while the band is hidden', async () => {
    await setRow('certification', { label: { mr: 'प्रमाणन', en: 'Certificate' } }).expect(200);
    await request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ isPublished: false }).expect(200);
    try {
      const res = await request(app).get(PUBLIC_URL).expect(200);
      expect(res.body.data.showSection).toBe(false);
      expect(res.body.data.rowLabels).toEqual({ certification: { mr: 'प्रमाणन', en: 'Certificate' } });
    } finally {
      await request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ isPublished: true }).expect(200);
    }
  });

  it('reads only known rows with both languages filled in, and the database admits only an object', async () => {
    await AppDataSource.query(
      `UPDATE "programme_highlight" SET "rowLabels" = $1::jsonb WHERE "isDelete" = false`,
      [
        JSON.stringify({
          bogus: { mr: 'अ', en: 'A' },
          schedule: { mr: 'वेळ', en: '  ' },
          perModule: { mr: 'मॉड्यूल', en: 5 },
          totalDuration: 'Hours',
          certification: { mr: 'प्रमाणन', en: 'Certificate' },
        }),
      ],
    );
    expect(await adminLabels()).toEqual({ certification: { mr: 'प्रमाणन', en: 'Certificate' } });
    expect(await publicLabels()).toEqual({ certification: { mr: 'प्रमाणन', en: 'Certificate' } });
    /* The next write keeps only the valid names. */
    await setRow('schedule', { label: { mr: 'वेळापत्रक', en: 'Timetable' } }).expect(200);
    expect(await stored()).toEqual({
      schedule: { mr: 'वेळापत्रक', en: 'Timetable' },
      certification: { mr: 'प्रमाणन', en: 'Certificate' },
    });

    await expect(AppDataSource.query(`UPDATE "programme_highlight" SET "rowLabels" = '[]'::jsonb`)).rejects.toThrow(
      /CHK_programme_highlight_row_labels/,
    );
    await expect(AppDataSource.query(`UPDATE "programme_highlight" SET "rowLabels" = '"x"'::jsonb`)).rejects.toThrow(
      /CHK_programme_highlight_row_labels/,
    );
  });

  it('needs cms-highlight.update', async () => {
    const viewer = await actorWith(['cms-highlight.view']);
    expect((await request(app).get(ADMIN_URL).set(auth(viewer.token))).body.data.rowLabels).toEqual({});
    expect((await setRow('schedule', { label: { mr: 'वेळ', en: 'Timing' } }, viewer.token)).status).toBe(403);
    expect((await request(app).patch(`${ADMIN_URL}/rows/schedule`).send({ label: null })).status).toBe(401);
    expect(await adminLabels()).toEqual({});
  });
});
