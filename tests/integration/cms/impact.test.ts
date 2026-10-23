import type { Express } from 'express';
import type { QueryRunner } from 'typeorm';
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
import { seedAmrutImpact } from '../../../src/database/seeds/seed-amrut-impact';
import { CmsAmrutImpact1794500000000 } from '../../../src/database/migrations/1794500000000-CmsAmrutImpact';
import { auditService } from '../../../src/modules/audit/audit.service';

const ADMIN_URL = `${API}/cms/impact`;
const PUBLIC_URL = `${API}/public/impact`;
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

let app: Express;
let admin: TestActor;

interface Pair {
  mr: string;
  en: string;
}
interface AdminStat {
  id: string;
  value: string;
  label: Pair;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
interface PublicStat {
  id: string;
  value: string;
  label: Pair;
}
interface Detail {
  field: string;
  message: string;
}

const pair = (mr: string, en: string): Pair => ({ mr, en });
const HEADING = pair('अमृतचा प्रभाव', "AMRUT's Impact");

/* The four figures the website showed before the section was managed (home/sections/Impact.tsx), in order. */
const SEEDED = [
  { value: '6+', label: pair('योजना सुरू', 'Schemes running') },
  { value: '1,000+', label: pair('लाभार्थी प्रवेशित', 'Beneficiaries enrolled') },
  { value: '36', label: pair('जिल्ह्यांमध्ये पोहोच', 'Districts covered') },
  { value: '10', label: pair('मंजूर प्रशिक्षण केंद्रे', 'Approved centres') },
];

const stat = (n: number, extra: Record<string, unknown> = {}) => ({
  value: `${n}+`,
  label: pair(`चाचणी आकडा ${n}`, `Test figure ${n}`),
  ...extra,
});

const details = (res: { body: { error: { details: Detail[] } } }) => res.body.error.details;
const fieldsOf = (res: { body: { error: { details: Detail[] } } }) =>
  details(res)
    .map((d) => d.field)
    .sort();
const list = async (): Promise<AdminStat[]> => (await request(app).get(ADMIN_URL).set(auth(admin.token)).expect(200)).body.data;
const publicFeed = async () => (await request(app).get(PUBLIC_URL).expect(200)).body.data;
const publicStats = async () => (await publicFeed()).stats as PublicStat[];
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
const setStatus = (id: string, isActive: unknown) =>
  request(app).patch(`${ADMIN_URL}/${id}/status`).set(auth(admin.token)).send({ isActive });
const reorder = (ids: unknown) => request(app).put(`${ADMIN_URL}/order`).set(auth(admin.token)).send({ ids });
const putSettings = (payload: unknown) =>
  request(app)
    .put(`${ADMIN_URL}/settings`)
    .set(auth(admin.token))
    .send(payload as object);
const getSettings = async () => (await request(app).get(`${ADMIN_URL}/settings`).set(auth(admin.token)).expect(200)).body.data;
const get = async (id: string): Promise<AdminStat> =>
  (await request(app).get(`${ADMIN_URL}/${id}`).set(auth(admin.token)).expect(200)).body.data;
const countRows = async () =>
  (await AppDataSource.query(`SELECT count(*)::int AS n FROM "impact_stats" WHERE "isDelete" = false`))[0].n as number;
const auditCount = async (action: string) =>
  (await AppDataSource.query(`SELECT count(*)::int AS n FROM "audit_logs" WHERE "action" = $1`, [action]))[0].n as number;
const lastAudit = async (action: string) =>
  (
    await AppDataSource.query(
      `SELECT "resource", "resourceId", "outcome", "details", "actorUserId" FROM "audit_logs" WHERE "action" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
      [action],
    )
  )[0];

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
});
afterAll(teardownTestApp);
afterEach(() => jest.restoreAllMocks());

describe("AMRUT's Impact — before the seed", () => {
  it('the public feed is null (200) while the section is not configured', async () => {
    const res = await request(app).get(PUBLIC_URL);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
    expect((await request(app).get(`${ADMIN_URL}/settings`).set(auth(admin.token))).status).toBe(404);
    expect(await list()).toEqual([]);
  });
});

describe("AMRUT's Impact seed", () => {
  it('seeds exactly the heading and the four figures the website showed, in order, all active', async () => {
    expect(await seedAmrutImpact(AppDataSource)).toEqual({ created: true, statsCreated: 4 });
    const rows = await list();
    expect(rows.map(({ value, label }) => ({ value, label }))).toEqual(SEEDED);
    expect(rows.map((r) => [r.displayOrder, r.isActive])).toEqual(SEEDED.map((_, i) => [i + 1, true]));

    expect(await getSettings()).toMatchObject({ heading: HEADING, showSection: true });

    const pub = await publicFeed();
    expect(pub).toEqual({ heading: HEADING, showSection: true, stats: rows.map((r) => ({ id: r.id, value: r.value, label: r.label })) });
  });

  it('publishes the figures and nothing an administrator edits besides them', async () => {
    const pub = await publicFeed();
    expect(Object.keys(pub).sort()).toEqual(['heading', 'showSection', 'stats']);
    for (const s of pub.stats as Record<string, unknown>[]) expect(Object.keys(s).sort()).toEqual(['id', 'label', 'value']);
  });

  it('is idempotent and never brings back a deleted card', async () => {
    const [, second] = await list();
    await request(app).delete(`${ADMIN_URL}/${second!.id}`).set(auth(admin.token)).expect(200);
    expect(await seedAmrutImpact(AppDataSource)).toEqual({ created: false, statsCreated: 0 });
    expect((await list()).map((r) => r.id)).not.toContain(second!.id);
    const [{ n: sections }] = await AppDataSource.query(`SELECT count(*)::int AS n FROM "impact_section"`);
    expect(sections).toBe(1);
    /* Put the card back for the rest of the suite, as a new record. */
    await create({ ...SEEDED[1], displayOrder: 2 }).expect(201);
    expect((await list()).map(({ value, label }) => ({ value, label }))).toEqual(SEEDED);
  });
});

describe('Adding a card', () => {
  it('adds a fifth card at the end, collapses whitespace and keeps Marathi intact', async () => {
    const res = await create({ value: '  2,500 \n + ', label: pair('  नवीन   आकडा — ज्ञ, क्ष ', ' New   figure ') });
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Impact card created successfully');
    expect(res.body.data).toMatchObject({
      value: '2,500 +',
      label: pair('नवीन आकडा — ज्ञ, क्ष', 'New figure'),
      displayOrder: 5,
      isActive: true,
    });
    expect(Object.keys(res.body.data).sort()).toEqual(['createdAt', 'displayOrder', 'id', 'isActive', 'label', 'updatedAt', 'value']);
    const stats = await publicStats();
    expect(stats).toHaveLength(5);
    expect(stats[4]).toEqual({ id: res.body.data.id, value: '2,500 +', label: pair('नवीन आकडा — ज्ञ, क्ष', 'New figure') });
  });

  it('accepts the longest value and label, and keeps angle brackets as typed (the site prints text, never HTML)', async () => {
    const long = (await create({ value: 'x'.repeat(20), label: pair('म'.repeat(80), 'e'.repeat(80)) }).expect(201)).body.data as AdminStat;
    expect(long.value).toHaveLength(20);
    const html = (await create(stat(1, { value: '<b>9</b>', label: pair('<i>अ</i>', '<script>x</script>') })).expect(201)).body
      .data as AdminStat;
    expect(await get(html.id)).toMatchObject({ value: '<b>9</b>', label: pair('<i>अ</i>', '<script>x</script>') });
    expect((await publicStats()).find((s) => s.id === html.id)).toEqual({ id: html.id, value: '<b>9</b>', label: html.label });
  });

  it('adds a hidden card that the website does not show, and honours a given display order', async () => {
    const hidden = (await create(stat(2, { isActive: false, displayOrder: 3 })).expect(201)).body.data as AdminStat;
    expect(hidden).toMatchObject({ isActive: false, displayOrder: 3 });
    expect((await list()).map((r) => r.id)).toContain(hidden.id);
    expect((await publicStats()).map((s) => s.id)).not.toContain(hidden.id);
  });

  it('puts a new card last even after one at the highest display order', async () => {
    const top = (await create(stat(3, { displayOrder: 999 })).expect(201)).body.data as AdminStat;
    const next = (await create(stat(4)).expect(201)).body.data as AdminStat;
    expect(next.displayOrder).toBe(999);
    expect((await list()).slice(-2).map((r) => r.id)).toEqual([top.id, next.id]);
  });

  it('replays a double-submitted form (same Idempotency-Key) instead of adding the card twice', async () => {
    const KEY = 'impact-test-key-0005';
    const before = await countRows();
    const send = () => create(stat(5)).set('Idempotency-Key', KEY);
    const first = await send();
    expect(first.status).toBe(201);
    /*
     * The middleware records the first response once it has been sent, so a retry in that instant is
     * told the request is still in progress (409) — never given a second card. Wait for the record,
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

  it('answers a retry that overlaps the first request without adding a second card', async () => {
    const before = await countRows();
    const send = () => create(stat(6)).set('Idempotency-Key', 'impact-test-key-0006');
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status]).toEqual(expect.arrayContaining([201]));
    for (const r of [a, b]) expect([201, 409]).toContain(r.status);
    expect(await countRows()).toBe(before + 1);
  });
});

describe('Validation', () => {
  it('names each missing field', async () => {
    const res = await create({});
    expect(res.status).toBe(422);
    expect(fieldsOf(res)).toEqual(['body.label', 'body.value']);
    expect(details(res)).toEqual(
      expect.arrayContaining([
        { field: 'body.value', message: 'Value is required' },
        { field: 'body.label', message: 'Label is required' },
      ]),
    );
  });

  it.each([
    ['', 'Value is required'],
    ['   ', 'Value is required'],
    ['x'.repeat(21), 'Value must be at most 20 characters'],
    ['1\u0007', 'Value contains characters that are not allowed'],
    [42, 'Value must be text'],
    [null, 'Value must be text'],
  ])('refuses the value %j', async (value, message) => {
    const res = await create(stat(7, { value }));
    expect(res.status).toBe(422);
    expect(details(res)).toEqual([{ field: 'body.value', message }]);
  });

  it('refuses a missing or blank half of the label, an over-long label and control characters', async () => {
    expect(details(await create(stat(7, { label: { mr: 'फक्त मराठी' } })))).toEqual([
      { field: 'body.label.en', message: 'Label (English) is required' },
    ]);
    expect(details(await create(stat(7, { label: pair('  ', 'Only English') })))).toEqual([
      { field: 'body.label.mr', message: 'Label (Marathi) is required' },
    ]);
    expect(details(await create(stat(7, { label: pair('म'.repeat(81), 'ok') })))).toEqual([
      { field: 'body.label.mr', message: 'Label (Marathi) must be at most 80 characters' },
    ]);
    expect(details(await create(stat(7, { label: pair('ठीक', 'a\u0000b') })))).toEqual([
      { field: 'body.label.en', message: 'Label (English) contains characters that are not allowed' },
    ]);
    expect(details(await create(stat(7, { label: 'Schemes running' })))).toEqual([
      { field: 'body.label', message: 'Label must have Marathi and English text' },
    ]);
  });

  it.each([
    [0, 'Display order must be at least 1'],
    [1000, 'Display order must be at most 999'],
    [1.5, 'Display order must be a whole number'],
    ['3', 'Display order must be a number'],
  ])('refuses the display order %j', async (displayOrder, message) => {
    const res = await create(stat(7, { displayOrder }));
    expect(res.status).toBe(422);
    expect(details(res)).toEqual([{ field: 'body.displayOrder', message }]);
  });

  it('refuses unknown fields (also inside the label) and a status that is not true or false', async () => {
    const res = await create(stat(7, { isActive: 'yes', html: '<b>x</b>', label: { mr: 'अ', en: 'A', fr: 'B' } }));
    expect(res.status).toBe(422);
    expect(fieldsOf(res)).toEqual(['body', 'body.isActive', 'body.label']);
    expect(details(res)).toContainEqual({ field: 'body.isActive', message: 'Status must be true or false' });
    expect((await setStatus((await list())[0]!.id, 'yes')).status).toBe(422);
  });

  it('answers 422 for a malformed id and 404 for an unknown one', async () => {
    const A = auth(admin.token);
    for (const id of ['nope', '123', `${UNKNOWN}x`]) {
      expect((await request(app).get(`${ADMIN_URL}/${id}`).set(A)).status).toBe(422);
      expect((await patch(id, { value: '1' })).status).toBe(422);
      expect((await setStatus(id, false)).status).toBe(422);
      expect((await request(app).delete(`${ADMIN_URL}/${id}`).set(A)).status).toBe(422);
    }
    const res = await request(app).get(`${ADMIN_URL}/${UNKNOWN}`).set(A);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Impact card not found');
    expect((await patch(UNKNOWN, { value: '1' })).status).toBe(404);
    expect((await setStatus(UNKNOWN, false)).status).toBe(404);
    expect((await request(app).delete(`${ADMIN_URL}/${UNKNOWN}`).set(A)).status).toBe(404);
  });

  it('refuses a malformed reorder list', async () => {
    expect(details(await reorder(undefined))).toEqual([{ field: 'body.ids', message: 'ids is required' }]);
    expect(details(await reorder([]))).toEqual([{ field: 'body.ids', message: 'ids must list the cards' }]);
    expect(details(await reorder(['nope']))).toEqual([{ field: 'body.ids.0', message: 'Must be a valid UUID' }]);
    expect(details(await reorder([UNKNOWN, UNKNOWN]))).toEqual([{ field: 'body.ids', message: 'Each card may appear only once' }]);
    expect(
      (
        await request(app)
          .put(`${ADMIN_URL}/order`)
          .set(auth(admin.token))
          .send({ ids: [UNKNOWN], extra: 1 })
      ).status,
    ).toBe(422);
  });
});

describe('Editing a card', () => {
  let s: AdminStat;
  beforeAll(async () => {
    s = (await create(stat(10)).expect(201)).body.data;
  });

  it('changes only the fields sent', async () => {
    const res = await patch(s.id, { value: '12+' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Impact card updated successfully');
    expect(res.body.data).toMatchObject({ value: '12+', label: s.label, displayOrder: s.displayOrder, isActive: true });
    s = res.body.data;
  });

  it('updates value, label and display order together when the version matches', async () => {
    const res = await patch(s.id, {
      value: '40',
      label: pair('सुधारित आकडा', 'Updated figure'),
      displayOrder: 6,
      expectedUpdatedAt: s.updatedAt,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ value: '40', label: pair('सुधारित आकडा', 'Updated figure'), displayOrder: 6 });
    expect((await publicStats()).find((x) => x.id === s.id)).toEqual({
      id: s.id,
      value: '40',
      label: pair('सुधारित आकडा', 'Updated figure'),
    });
    s = await get(s.id);
  });

  it('refuses a save over a newer version (409), and changes nothing', async () => {
    const res = await patch(s.id, { value: '99', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(
      'This card was changed after you opened it. Reload to see the latest version, then make your changes again.',
    );
    expect(await get(s.id)).toEqual(s);
    expect((await patch(s.id, { value: '99', expectedUpdatedAt: 'yesterday' })).status).toBe(422);
  });

  it('keeps the saved card when the database save fails', async () => {
    jest.spyOn(auditService, 'recordInTx').mockRejectedValueOnce(new Error('simulated database failure'));
    const res = await patch(s.id, { value: '0', label: pair('टिकू नये', 'Must not stick') });
    expect(res.status).toBe(500);
    expect(await get(s.id)).toEqual(s);
  });

  it('keeps the saved card when an invalid edit is refused', async () => {
    expect((await patch(s.id, { value: ' ', label: pair('', '') })).status).toBe(422);
    expect((await patch(s.id, { createdAt: '2020-01-01T00:00:00.000Z' })).status).toBe(422);
    expect(await get(s.id)).toEqual(s);
  });

  it('a hidden card leaves the website and comes back when shown', async () => {
    const hide = await setStatus(s.id, false);
    expect(hide.status).toBe(200);
    expect(hide.body.message).toBe('Impact card hidden from the website');
    expect(hide.body.data.isActive).toBe(false);
    expect((await publicStats()).map((c) => c.id)).not.toContain(s.id);
    expect((await list()).map((c) => c.id)).toContain(s.id);
    const show = await setStatus(s.id, true);
    expect(show.body.message).toBe('Impact card shown on the website');
    expect((await publicStats()).map((c) => c.id)).toContain(s.id);
  });
});

describe('Deleting and ordering', () => {
  it('deletes only the chosen card: soft-deleted, gone from the website, the rest untouched', async () => {
    const s = (await create(stat(20)).expect(201)).body.data as AdminStat;
    const others = (await list()).filter((x) => x.id !== s.id);
    const res = await request(app).delete(`${ADMIN_URL}/${s.id}`).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Impact card deleted successfully');
    expect(await list()).toEqual(others);
    expect((await publicStats()).map((c) => c.id)).not.toContain(s.id);
    const [row] = await AppDataSource.query(`SELECT "isDelete", "isActive" FROM "impact_stats" WHERE "id" = $1`, [s.id]);
    expect(row).toEqual({ isDelete: true, isActive: false });
    expect((await request(app).delete(`${ADMIN_URL}/${s.id}`).set(auth(admin.token))).status).toBe(404);
    expect((await request(app).get(`${ADMIN_URL}/${s.id}`).set(auth(admin.token))).status).toBe(404);
  });

  it('lists every card, hidden ones included, in display order', async () => {
    const rows = await list();
    expect(rows.some((r) => !r.isActive)).toBe(true);
    const orders = rows.map((r) => r.displayOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('reorders by id (1..n) and the website follows; refuses a stale list', async () => {
    const ids = (await list()).map((r) => r.id);
    const reversed = [...ids].reverse();
    const res = await reorder(reversed);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Display order updated successfully');
    expect((res.body.data as AdminStat[]).map((r) => [r.id, r.displayOrder])).toEqual(reversed.map((id, i) => [id, i + 1]));
    const activeIds = new Set((await list()).filter((r) => r.isActive).map((r) => r.id));
    expect((await publicStats()).map((c) => c.id)).toEqual(reversed.filter((id) => activeIds.has(id)));

    const stale = await reorder(reversed.slice(1));
    expect(stale.status).toBe(409);
    expect(stale.body.message).toBe('The card list changed after you loaded it. Reload the list, then reorder again.');
    expect((await reorder([...reversed.slice(1), UNKNOWN])).status).toBe(409);
    expect((await list()).map((r) => r.id)).toEqual(reversed);
  });
});

describe('Section settings', () => {
  it('updates the heading, and hiding the section empties the public figures but keeps the cards', async () => {
    const current = await getSettings();
    expect(Object.keys(current).sort()).toEqual(['createdAt', 'heading', 'id', 'showSection', 'updatedAt']);
    const res = await putSettings({
      heading: pair('  नवीन   शीर्षक ', 'New heading'),
      showSection: true,
      expectedUpdatedAt: current.updatedAt,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ heading: pair('नवीन शीर्षक', 'New heading'), showSection: true });
    expect(await publicFeed()).toMatchObject({ heading: pair('नवीन शीर्षक', 'New heading'), showSection: true });

    await putSettings({ heading: HEADING, showSection: false }).expect(200);
    expect(await publicFeed()).toEqual({ heading: HEADING, showSection: false, stats: [] });
    expect((await list()).length).toBeGreaterThan(4);

    await putSettings({ heading: HEADING, showSection: true }).expect(200);
    expect((await publicStats()).length).toBeGreaterThan(4);
  });

  it('requires both halves of the heading and the visibility, and refuses unknown keys and stale saves', async () => {
    const res = await putSettings({ heading: pair('', 'x'.repeat(121)), extra: true });
    expect(res.status).toBe(422);
    expect(fieldsOf(res)).toEqual(['body', 'body.heading.en', 'body.heading.mr', 'body.showSection']);
    expect(details(res)).toEqual(
      expect.arrayContaining([
        { field: 'body.heading.mr', message: 'Heading (Marathi) is required' },
        { field: 'body.heading.en', message: 'Heading (English) must be at most 120 characters' },
        { field: 'body.showSection', message: 'showSection is required' },
      ]),
    );
    const before = await getSettings();
    const stale = await putSettings({ heading: pair('अ', 'A'), showSection: true, expectedUpdatedAt: '2020-01-01T00:00:00.000Z' });
    expect(stale.status).toBe(409);
    expect(await getSettings()).toEqual(before);
  });
});

describe('Section not configured', () => {
  it('reports the missing row to the admin screen (404) and serves null publicly', async () => {
    try {
      /* Soft-deleting the row is what "no configuration" looks like; restored afterwards. */
      await AppDataSource.query(`UPDATE "impact_section" SET "isDelete" = true`);
      const res = await request(app).get(`${ADMIN_URL}/settings`).set(auth(admin.token));
      expect(res.status).toBe(404);
      expect(res.body.message).toBe("The AMRUT's Impact section has not been configured yet. Run the database seed to create it.");
      expect((await putSettings({ heading: HEADING, showSection: true })).status).toBe(404);
      const pub = await request(app).get(PUBLIC_URL);
      expect(pub.status).toBe(200);
      expect(pub.body.data).toBeNull();
    } finally {
      await AppDataSource.query(`UPDATE "impact_section" SET "isDelete" = false`);
    }
    expect((await publicFeed()).heading).toEqual(HEADING);
  });
});

describe('Audit trail', () => {
  it('records every change with its actor, and nothing for a refused one', async () => {
    const A = 'amrut-impact-stat';
    const s = (await create(stat(40)).expect(201)).body.data as AdminStat;
    expect(await lastAudit('cms.amrut-impact-stat.create')).toEqual({
      resource: A,
      resourceId: s.id,
      outcome: 'SUCCESS',
      details: { value: '40+', label: 'Test figure 40', isActive: true },
      actorUserId: admin.user.id,
    });

    await patch(s.id, { value: '41+', displayOrder: 7 }).expect(200);
    expect(await lastAudit('cms.amrut-impact-stat.update')).toMatchObject({
      resource: A,
      resourceId: s.id,
      details: { fields: ['value', 'displayOrder'] },
      actorUserId: admin.user.id,
    });

    await setStatus(s.id, false).expect(200);
    expect(await lastAudit('cms.amrut-impact-stat.status')).toMatchObject({ resource: A, resourceId: s.id, details: { isActive: false } });

    const ids = (await list()).map((r) => r.id);
    await reorder(ids).expect(200);
    expect(await lastAudit('cms.amrut-impact-stats.reorder')).toMatchObject({ resource: A, resourceId: null, details: { order: ids } });

    await request(app).delete(`${ADMIN_URL}/${s.id}`).set(auth(admin.token)).expect(200);
    expect(await lastAudit('cms.amrut-impact-stat.delete')).toMatchObject({
      resource: A,
      resourceId: s.id,
      details: { value: '41+', label: 'Test figure 40' },
    });

    const section = await getSettings();
    await putSettings({ heading: HEADING, showSection: true }).expect(200);
    expect(await lastAudit('cms.amrut-impact-section.update')).toMatchObject({
      resource: 'amrut-impact-section',
      resourceId: section.id,
      details: { showSection: true },
      actorUserId: admin.user.id,
    });

    /* Refused requests leave no trace. */
    const [live] = await list();
    const updates = await auditCount('cms.amrut-impact-stat.update');
    const creates = await auditCount('cms.amrut-impact-stat.create');
    await patch(live!.id, { value: '' }).expect(422);
    await patch(live!.id, { value: '1', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }).expect(409);
    await create({ value: '' }).expect(422);
    expect(await auditCount('cms.amrut-impact-stat.update')).toBe(updates);
    expect(await auditCount('cms.amrut-impact-stat.create')).toBe(creates);
  });
});

describe('Access control', () => {
  it('refuses every admin route without a session; the public feed needs none', async () => {
    const id = UNKNOWN;
    expect((await request(app).get(ADMIN_URL)).status).toBe(401);
    expect((await request(app).post(ADMIN_URL).send(stat(30))).status).toBe(401);
    expect((await request(app).get(`${ADMIN_URL}/settings`)).status).toBe(401);
    expect((await request(app).put(`${ADMIN_URL}/settings`).send({})).status).toBe(401);
    expect(
      (
        await request(app)
          .put(`${ADMIN_URL}/order`)
          .send({ ids: [id] })
      ).status,
    ).toBe(401);
    expect((await request(app).get(`${ADMIN_URL}/${id}`)).status).toBe(401);
    expect((await request(app).patch(`${ADMIN_URL}/${id}`).send({ value: '1' })).status).toBe(401);
    expect((await request(app).patch(`${ADMIN_URL}/${id}/status`).send({ isActive: false })).status).toBe(401);
    expect((await request(app).delete(`${ADMIN_URL}/${id}`)).status).toBe(401);
    expect((await request(app).get(PUBLIC_URL)).status).toBe(200);
  });

  it('a view-only administrator can read but not create, edit, reorder, change settings or delete', async () => {
    const viewer = await actorWith(['cms-impact.view']);
    const before = await list();
    const settings = await getSettings();
    const first = before[0]!;
    const V = auth(viewer.token);
    expect((await request(app).get(ADMIN_URL).set(V)).status).toBe(200);
    expect((await request(app).get(`${ADMIN_URL}/${first.id}`).set(V)).status).toBe(200);
    expect((await request(app).get(`${ADMIN_URL}/settings`).set(V)).status).toBe(200);
    expect((await create(stat(31), viewer.token)).status).toBe(403);
    expect((await request(app).patch(`${ADMIN_URL}/${first.id}`).set(V).send({ value: '1' })).status).toBe(403);
    expect((await request(app).patch(`${ADMIN_URL}/${first.id}/status`).set(V).send({ isActive: false })).status).toBe(403);
    expect(
      (
        await request(app)
          .put(`${ADMIN_URL}/order`)
          .set(V)
          .send({ ids: before.map((r) => r.id) })
      ).status,
    ).toBe(403);
    expect((await request(app).put(`${ADMIN_URL}/settings`).set(V).send({ heading: HEADING, showSection: false })).status).toBe(403);
    expect((await request(app).delete(`${ADMIN_URL}/${first.id}`).set(V)).status).toBe(403);
    expect(await list()).toEqual(before);
    expect(await getSettings()).toEqual(settings);
  });

  it('update permission edits but does not add or delete', async () => {
    const editor = await actorWith(['cms-impact.view', 'cms-impact.update']);
    const [first] = await list();
    const E = auth(editor.token);
    expect((await request(app).patch(`${ADMIN_URL}/${first!.id}`).set(E).send({ value: first!.value })).status).toBe(200);
    expect((await create(stat(32), editor.token)).status).toBe(403);
    expect((await request(app).delete(`${ADMIN_URL}/${first!.id}`).set(E)).status).toBe(403);
  });

  it('another CMS permission does not open this section', async () => {
    const other = await actorWith(['cms-schemes.view', 'cms-schemes.update']);
    expect((await request(app).get(ADMIN_URL).set(auth(other.token))).status).toBe(403);
    expect((await request(app).get(`${ADMIN_URL}/settings`).set(auth(other.token))).status).toBe(403);
  });
});

describe('migration 1794500000000', () => {
  /* Runs one statement under a savepoint and reports the PostgreSQL error code, or null when it succeeded. */
  const attempt = async (qr: QueryRunner, sql: string, params: unknown[] = []): Promise<string | null> => {
    await qr.query('SAVEPOINT attempt');
    try {
      await qr.query(sql, params);
      return null;
    } catch (e) {
      const err = e as { code?: string; driverError?: { code?: string } };
      return err.driverError?.code ?? err.code ?? 'unknown';
    } finally {
      await qr.query('ROLLBACK TO SAVEPOINT attempt');
    }
  };

  /*
   * Runs down() then up() inside a transaction that is always rolled back, so the shared test
   * schema is left exactly as the migrations built it whatever happens here.
   */
  it('drops and recreates both tables, with the singleton and the CHECK rules enforced', async () => {
    const migration = new CmsAmrutImpact1794500000000();
    const qr = AppDataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await migration.down(qr);
      const [gone] = await qr.query(`SELECT to_regclass('impact_section') AS section, to_regclass('impact_stats') AS stats`);
      expect(gone).toEqual({ section: null, stats: null });

      await migration.up(qr);
      const [section] = await qr.query(
        `INSERT INTO "impact_section" ("headingMr", "headingEn") VALUES ('अ', 'A') RETURNING "showSection", "isActive", "isDelete"`,
      );
      expect(section).toEqual({ showSection: true, isActive: true, isDelete: false });

      /* One live configuration, ever. */
      expect(await attempt(qr, `INSERT INTO "impact_section" ("headingMr", "headingEn") VALUES ('ब', 'B')`)).toBe('23505');
      expect(await attempt(qr, `INSERT INTO "impact_section" ("headingMr", "headingEn", "isDelete") VALUES ('ब', 'B', true)`)).toBeNull();
      expect(await attempt(qr, `UPDATE "impact_section" SET "headingEn" = '  '`)).toBe('23514');
      expect(await attempt(qr, `UPDATE "impact_section" SET "headingMr" = ''`)).toBe('23514');

      const insertStat = (value: string | null, labelMr = 'ल', labelEn = 'L', order: number | null = 1) =>
        attempt(qr, `INSERT INTO "impact_stats" ("value", "labelMr", "labelEn", "displayOrder") VALUES ($1, $2, $3, $4)`, [
          value,
          labelMr,
          labelEn,
          order,
        ]);
      expect(await insertStat('36')).toBeNull();
      expect(await insertStat('36', 'ल', 'L', 999)).toBeNull();
      /* A blank figure is refused by the database itself, not only by the request rules. */
      expect(await insertStat('')).toBe('23514');
      expect(await insertStat('   ')).toBe('23514');
      expect(await insertStat(null)).toBe('23502');
      expect(await insertStat('36', ' ')).toBe('23514');
      expect(await insertStat('36', 'ल', '')).toBe('23514');
      expect(await insertStat('36', 'ल', 'L', 0)).toBe('23514');
      expect(await insertStat('36', 'ल', 'L', 1000)).toBe('23514');
      expect(await insertStat('36', 'ल', 'L', null)).toBe('23502');
      expect(await insertStat('x'.repeat(21))).toBe('22001');
      expect(await insertStat('36', 'x'.repeat(81))).toBe('22001');

      const triggers: { tgname: string }[] = await qr.query(
        `SELECT tgname FROM pg_trigger WHERE tgname IN ('TRG_impact_section_updated_at', 'TRG_impact_stats_updated_at') ORDER BY tgname`,
      );
      expect(triggers.map((t) => t.tgname)).toEqual(['TRG_impact_section_updated_at', 'TRG_impact_stats_updated_at']);
    } finally {
      await qr.rollbackTransaction();
      await qr.release();
    }
    /* The rollback left the seeded section in place. */
    expect((await request(app).get(`${ADMIN_URL}/settings`).set(auth(admin.token))).status).toBe(200);
    expect((await publicFeed()).heading).toEqual(HEADING);
  });
});
