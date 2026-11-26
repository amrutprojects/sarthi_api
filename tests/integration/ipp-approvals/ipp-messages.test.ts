import type { Express } from 'express';
import { env } from '../../../src/config/env.config';
import {
  decisions,
  divisionalOfficer,
  events,
  IPP_SECRET,
  ippCall,
  ippSignature,
  MESSAGES,
  NASHIK,
  nextSeq,
  PING,
  PUNE,
  resetIpp,
  restoreLink,
  seedDistricts,
  stageOf,
  submit,
  switchLink,
  unixNow,
  wireApplication,
  wireBatch,
  wireMessage,
  type WireBatch,
} from '../../helpers/ipp';
import { API, AppDataSource, auth, request, setupTestApp, teardownTestApp } from '../../helpers/test-app';

/* IPP → Sarthi: /integration/v1/ipp (contract ipp_backend/docs/SARTHI_LINK.md sections 1 and 2). */
let app: Express;
let districts: Record<'PUN' | 'NAS' | 'THA', string>;

beforeAll(async () => {
  app = await setupTestApp();
  districts = await seedDistricts();
});
afterAll(async () => {
  restoreLink();
  await teardownTestApp();
});
beforeEach(async () => {
  switchLink(true);
  await resetIpp();
});

const send = (message: unknown) => ippCall(app, 'POST', MESSAGES, message);
const count = async (table: string): Promise<number> =>
  ((await AppDataSource.query(`SELECT count(*)::int AS n FROM "${table}"`)) as { n: number }[])[0].n;
const application = async (id: string) =>
  ((await AppDataSource.query(`SELECT * FROM "ipp_applications" WHERE "id" = $1`, [id])) as Record<string, unknown>[])[0];
/* Back with the Auditor, as after a rejection of the Divisional Officer. */
const withAuditor = (id: string) =>
  AppDataSource.query(`UPDATE "ipp_applications" SET "stage" = 'AUDITOR', "stageEvent" = 'REJECTED' WHERE "id" = $1`, [id]);

describe('signature', () => {
  const body = JSON.stringify({ any: 'thing' });
  const call = (o: {
    path?: string;
    signedPath?: string;
    body?: string;
    signedBody?: string;
    client?: string;
    as?: string;
    timestamp?: string;
    secret?: string;
  }) => {
    const timestamp = o.timestamp ?? unixNow();
    const path = o.path ?? MESSAGES;
    const signature = ippSignature({
      client: o.client ?? 'ipp',
      method: 'POST',
      path: o.signedPath ?? path,
      timestamp,
      body: o.signedBody ?? o.body ?? body,
      secret: o.secret,
    });
    return request(app)
      .post(path)
      .set({
        Authorization: `IPP-SARTHI ${o.as ?? o.client ?? 'ipp'}:${signature}`,
        'X-Timestamp': timestamp,
        'Content-Type': 'application/json',
      })
      .send(o.body ?? body);
  };
  const refused = async (res: { status: number; body: { error?: { code: string }; data: unknown } }) => {
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('LINK_UNAUTHORIZED');
    expect(res.body.data).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain(IPP_SECRET);
  };

  it('a good signature gets through (ping; a body is then checked as a message)', async () => {
    const res = await ippCall(app, 'GET', PING);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ ok: true, time: expect.stringMatching(/^\d{4}-.*Z$/) });
    expect((await call({})).status).toBe(422);
  });

  it('missing, malformed and wrong signatures are refused', async () => {
    await refused(await request(app).get(PING));
    await refused(await request(app).get(PING).set('Authorization', 'Bearer abc').set('X-Timestamp', unixNow()));
    await refused(await call({ secret: 'another-secret-another-secret-another-1' }));
    await refused(await request(app).post(MESSAGES).set('Content-Type', 'application/json').send(body));
  });

  it('a timestamp outside 300 seconds is refused, before and after', async () => {
    await refused(await call({ timestamp: String(Number(unixNow()) - 301) }));
    await refused(await call({ timestamp: String(Number(unixNow()) + 302) }));
    await refused(await call({ timestamp: 'now' }));
    expect((await call({ timestamp: String(Number(unixNow()) - 290) })).status).toBe(422);
  });

  it("a call of Sarthi sent back to it is refused (client 'sarthi'), however it is labelled", async () => {
    await refused(await call({ client: 'sarthi' }));
    await refused(await call({ client: 'sarthi', as: 'ipp' }));
  });

  it('another path, query or body than the one signed is refused', async () => {
    await refused(await call({ signedPath: PING }));
    await refused(await call({ path: `${MESSAGES}?x=1`, signedPath: MESSAGES }));
    await refused(await call({ signedBody: '{"any":"thin"}' }));
    expect((await call({ path: `${MESSAGES}?x=1` })).status).toBe(422);
  });

  it('a session is no way in, and the admin API is not reached with a signature', async () => {
    const officer = await divisionalOfficer([]);
    await refused(await request(app).get(PING).set(auth(officer.token)));
    const path = `${API}/ipp-approvals/summary`;
    const timestamp = unixNow();
    const res = await request(app)
      .get(path)
      .set({ Authorization: `IPP-SARTHI ipp:${ippSignature({ method: 'GET', path, timestamp, body: '' })}`, 'X-Timestamp': timestamp });
    expect(res.status).toBe(401);
  });

  it('link off or not configured → 503 LINK_NOT_CONFIGURED', async () => {
    switchLink(false);
    let res = await ippCall(app, 'GET', PING);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('LINK_NOT_CONFIGURED');
    switchLink(true);
    Object.assign(env, { IPP_LINK_SECRET: undefined });
    res = await ippCall(app, 'POST', MESSAGES, wireMessage(wireBatch(), []));
    expect(res.status).toBe(503);
  });

  it('an unknown path under the link is 404 only once it is signed', async () => {
    await refused(await request(app).get('/integration/v1/ipp/none'));
    expect((await ippCall(app, 'GET', '/integration/v1/ipp/none')).status).toBe(404);
  });

  it('a body over 5 MB is refused', async () => {
    const res = await call({ body: JSON.stringify({ x: 'a'.repeat(5 * 1024 * 1024 + 10) }) });
    expect(res.status).toBe(413);
  });
});

describe('SUBMIT, RESUBMIT, UPDATE', () => {
  it('SUBMIT adds the batch and the form at DIVISION, with the event RECEIVED', async () => {
    const batch = wireBatch();
    const form = wireApplication();
    const message = wireMessage(batch, [form]);
    const res = await send(message);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: message.id, duplicate: false, applications: [{ id: form.id, stage: 'DIVISION' }] });
    expect(await application(form.id)).toMatchObject({
      registrationId: form.registration_id,
      name: form.name,
      mobile: form.mobile_number,
      aadhaarMasked: 'XXXX-XXXX-1234',
      formDistrict: 'Pune',
      stage: 'DIVISION',
      reached: 1,
      lastSeq: String(message.seq),
    });
    expect(await events(form.id)).toEqual([
      expect.objectContaining({
        event: 'RECEIVED',
        fromStage: null,
        toStage: 'DIVISION',
        byName: 'Synthetic Auditor',
        byRole: 'IPP Auditor',
      }),
    ]);
    const [row] = (await AppDataSource.query(`SELECT * FROM "ipp_batches"`)) as Record<string, unknown>[];
    expect(row).toMatchObject({
      ippId: batch.id,
      code: batch.code,
      districtId: districts.PUN,
      deliveryMode: 'OFFLINE',
      sentBy: 'Synthetic Auditor',
    });
    /* Nothing goes back to IPP for what it sent itself. */
    expect(await decisions()).toEqual([]);
  });

  it('a message of 0 applications only writes the batch; one of 100 is done as a whole', async () => {
    const batch = wireBatch();
    expect((await send(wireMessage(batch, []))).body.data.applications).toEqual([]);
    const res = await send(
      wireMessage(
        { ...batch, name: 'Renamed' },
        Array.from({ length: 100 }, () => wireApplication()),
      ),
    );
    expect(res.status).toBe(200);
    expect(res.body.data.applications).toHaveLength(100);
    expect(await count('ipp_applications')).toBe(100);
    const rows = (await AppDataSource.query(`SELECT "name" FROM "ipp_batches"`)) as { name: string }[];
    expect(rows).toEqual([{ name: 'Renamed' }]);
  });

  it('the same message again answers duplicate with the stages of now, and changes nothing', async () => {
    const form = wireApplication();
    const message = wireMessage(wireBatch(), [form]);
    await send(message);
    await withAuditor(form.id);
    const res = await send({ ...message, applications: [{ ...form, name: 'Changed' }] });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: message.id, duplicate: true, applications: [{ id: form.id, stage: 'AUDITOR' }] });
    expect((await application(form.id)).name).toBe(form.name);
    expect(await events(form.id)).toHaveLength(1);
    expect(await count('ipp_messages')).toBe(1);
  });

  it('the same message twice at once is done once', async () => {
    const form = wireApplication();
    const message = wireMessage(wireBatch(), [form]);
    const answers = await Promise.all([send(message), send(message), send(message)]);
    expect(answers.map((a) => a.status)).toEqual([200, 200, 200]);
    expect(answers.map((a) => a.body.data.duplicate).sort()).toEqual([false, true, true]);
    expect(await events(form.id)).toHaveLength(1);
  });

  it('SUBMIT of a form already in the batch is an UPDATE: new snapshot, same stage, event CORRECTED', async () => {
    const batch = wireBatch();
    const form = wireApplication();
    await submit(app, batch, [form]);
    await AppDataSource.query(`UPDATE "ipp_applications" SET "stage" = 'COEP', "stageEvent" = 'APPROVED', "reached" = 2 WHERE "id" = $1`, [
      form.id,
    ]);
    const res = await send(wireMessage(batch, [{ ...form, name: 'Corrected Name', action: 'SUBMIT' }]));
    expect(res.body.data.applications).toEqual([{ id: form.id, stage: 'COEP' }]);
    expect(await application(form.id)).toMatchObject({ name: 'Corrected Name', stage: 'COEP' });
    expect((await events(form.id)).map((e) => [e.event, e.fromStage, e.toStage])).toEqual([
      ['RECEIVED', null, 'DIVISION'],
      ['CORRECTED', 'COEP', 'COEP'],
    ]);
  });

  it('UPDATE replaces the snapshot and names who corrected it; unknown → 409 APPLICATION_UNKNOWN', async () => {
    const batch = wireBatch();
    const form = wireApplication();
    await submit(app, batch, [form]);
    const edits = [
      { at: '2026-11-25T06:00:00Z', by: 'Second Auditor', changes: [{ key: 'full_name', label: 'Full name', from: 'A', to: 'B' }] },
    ];
    const res = await send(wireMessage(batch, [{ ...form, action: 'UPDATE', name: 'B', edits }]));
    expect(res.status).toBe(200);
    expect(await application(form.id)).toMatchObject({
      name: 'B',
      stage: 'DIVISION',
      edits: [expect.objectContaining({ by: 'Second Auditor' })],
    });
    expect((await events(form.id)).at(-1)).toMatchObject({ event: 'CORRECTED', byName: 'Second Auditor' });

    const unknown = await send(wireMessage(batch, [wireApplication({ action: 'UPDATE' })]));
    expect(unknown.status).toBe(409);
    expect(unknown.body.error.code).toBe('APPLICATION_UNKNOWN');
  });

  it('RESUBMIT brings a form back from the Auditor; unknown → as SUBMIT; anywhere else → 409 STAGE_MISMATCH', async () => {
    const batch = wireBatch();
    const form = wireApplication();
    await submit(app, batch, [form]);
    const early = await send(wireMessage(batch, [{ ...form, action: 'RESUBMIT' }]));
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('STAGE_MISMATCH');

    await withAuditor(form.id);
    const res = await send(wireMessage(batch, [{ ...form, action: 'RESUBMIT', name: 'Corrected' }]));
    expect(res.body.data.applications).toEqual([{ id: form.id, stage: 'DIVISION' }]);
    expect(await application(form.id)).toMatchObject({ name: 'Corrected', stage: 'DIVISION', stageEvent: 'RESUBMITTED' });
    expect((await events(form.id)).at(-1)).toMatchObject({ event: 'RESUBMITTED', fromStage: 'AUDITOR', toStage: 'DIVISION' });

    const fresh = wireApplication({ action: 'RESUBMIT' });
    expect((await send(wireMessage(batch, [fresh]))).body.data.applications).toEqual([{ id: fresh.id, stage: 'DIVISION' }]);
    expect((await events(fresh.id)).map((e) => e.event)).toEqual(['RECEIVED']);
  });

  it('a form of another batch is refused, whatever the action', async () => {
    const form = wireApplication();
    await submit(app, wireBatch(), [form]);
    for (const action of ['SUBMIT', 'UPDATE', 'RESUBMIT']) {
      const res = await send(wireMessage(wireBatch(), [{ ...form, action }]));
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('APPLICATION_IN_OTHER_BATCH');
    }
  });

  it('a message is done as a whole or not at all, and can be sent again after it was refused', async () => {
    const batch = wireBatch();
    const good = wireApplication();
    const message = wireMessage(batch, [good, wireApplication({ action: 'UPDATE' })]);
    expect((await send(message)).status).toBe(409);
    expect(await count('ipp_batches')).toBe(0);
    expect(await count('ipp_applications')).toBe(0);
    expect(await count('ipp_messages')).toBe(0);
    const again = await send({ ...message, applications: [good] });
    expect(again.body.data).toMatchObject({ duplicate: false });
  });

  it('an older snapshot never replaces a newer one (form and batch)', async () => {
    const batch = wireBatch({ name: 'Newer name' });
    const form = wireApplication({ name: 'Newer' });
    const older = nextSeq();
    const newer = nextSeq();
    await send(wireMessage(batch, [form], { seq: newer }));
    const res = await send(wireMessage({ ...batch, name: 'Older name' }, [{ ...form, action: 'UPDATE', name: 'Older' }], { seq: older }));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ duplicate: false, applications: [{ id: form.id, stage: 'DIVISION' }] });
    expect(await application(form.id)).toMatchObject({ name: 'Newer', lastSeq: String(newer) });
    expect(await events(form.id)).toHaveLength(1);
    const [row] = (await AppDataSource.query(`SELECT "name" FROM "ipp_batches"`)) as { name: string }[];
    expect(row.name).toBe('Newer name');
  });

  it('an older RESUBMIT still brings the form back, but keeps the newer snapshot', async () => {
    const batch = wireBatch();
    const form = wireApplication();
    const older = nextSeq();
    await send(wireMessage(batch, [{ ...form, name: 'Newer' }], { seq: nextSeq() }));
    await withAuditor(form.id);
    await send(wireMessage(batch, [{ ...form, action: 'RESUBMIT', name: 'Older' }], { seq: older }));
    expect(await application(form.id)).toMatchObject({ name: 'Newer', stage: 'DIVISION' });
  });
});

describe('district of the batch', () => {
  const district = async (wire: Partial<WireBatch['district']>) => {
    const batch = wireBatch({ district: { ...PUNE, ...wire } });
    const res = await send(wireMessage(batch, []));
    if (res.status !== 200) return { status: res.status, code: res.body.error.code as string };
    const [row] = (await AppDataSource.query(`SELECT "districtId" FROM "ipp_batches" WHERE "ippId" = $1`, [batch.id])) as {
      districtId: string;
    }[];
    return row.districtId;
  };

  it('is matched by code (any case, with or without the state), then by name, then by a known other spelling', async () => {
    expect(await district({ code: 'pun' })).toBe(districts.PUN);
    expect(await district({ code: 'MH-NAS', name: 'Nashik' })).toBe(districts.NAS);
    expect(await district({ code: '521', name: 'PUNE' })).toBe(districts.PUN);
    expect(await district({ code: '516', name: 'नाशिक' })).toBe(districts.NAS);
  });

  it('is refused when unknown, inactive, or when code and name mean two districts', async () => {
    const unknown = { status: 409, code: 'DISTRICT_UNKNOWN' };
    expect(await district({ code: 'XYZ', name: 'Nowhere' })).toEqual(unknown);
    expect(await district({ code: 'PUN', name: 'Nashik' })).toEqual(unknown);
    await AppDataSource.query(`UPDATE "districts" SET "isActive" = false WHERE "id" = $1`, [districts.THA]);
    expect(await district({ code: 'THA', name: 'Thane' })).toEqual(unknown);
    await AppDataSource.query(`UPDATE "districts" SET "isActive" = true WHERE "id" = $1`, [districts.THA]);
    expect(await district({ code: 'THA', name: 'Thane' })).toBe(districts.THA);
    expect(await count('ipp_batches')).toBe(1);
  });

  it('two states with the same code: the state decides, and without it nothing is guessed', async () => {
    const [goa] = (await AppDataSource.query(`INSERT INTO "states" ("name", "code") VALUES ('Goa', 'GA') RETURNING "id"`)) as {
      id: string;
    }[];
    const [twin] = (await AppDataSource.query(
      `INSERT INTO "districts" ("stateId", "name", "code") VALUES ($1, 'Punem', 'PUN') RETURNING "id"`,
      [goa.id],
    )) as { id: string }[];
    expect(await district({ code: 'PUN', name: 'Any', state_code: 'GA' })).toBe(twin.id);
    expect(await district({ code: 'PUN', name: 'Any', state_code: 'ZZ' })).toEqual({ status: 409, code: 'DISTRICT_UNKNOWN' });
    await AppDataSource.query(`UPDATE "districts" SET "isDelete" = true, "isActive" = false WHERE "id" = $1`, [twin.id]);
  });
});

describe('malformed messages → 422, without repeating values', () => {
  const bad: [string, (m: ReturnType<typeof wireMessage>) => unknown][] = [
    ['no batch', (m) => ({ ...m, batch: undefined })],
    ['id not a uuid', (m) => ({ ...m, id: 'x' })],
    ['seq 0', (m) => ({ ...m, seq: 0 })],
    ['unknown action', (m) => ({ ...m, applications: [wireApplication({ action: 'SECRET-VALUE' })] })],
    ['unknown delivery mode', (m) => ({ ...m, batch: { ...m.batch, delivery_mode: 'SECRET-VALUE' } })],
    ['a full Aadhaar number', (m) => ({ ...m, applications: [wireApplication({ aadhaar_masked: '1234-5678-9012' })] })],
    ['101 applications', (m) => ({ ...m, applications: Array.from({ length: 101 }, () => wireApplication()) })],
    ['date not a date', (m) => ({ ...m, batch: { ...m.batch, start_date: '2026-02-31' } })],
    ['name missing', (m) => ({ ...m, applications: [wireApplication({ name: ' ' })] })],
    [
      'the same application twice',
      (m) => {
        const a = wireApplication();
        return { ...m, applications: [a, a] };
      },
    ],
  ];
  it.each(bad)('%s', async (_name, change) => {
    const res = await send(change(wireMessage(wireBatch(), [wireApplication()])));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toMatch(/SECRET-VALUE|5678/);
    expect(await count('ipp_applications')).toBe(0);
  });

  it('says where at most 20 times', async () => {
    const forms = Array.from({ length: 60 }, () => wireApplication({ name: '' }));
    const res = await send(wireMessage(wireBatch(), forms));
    expect(res.body.error.details).toHaveLength(20);
  });

  it('text that a database cannot hold is stored without the unusable characters', async () => {
    const form = wireApplication({
      name: 'As\u0000ha \ud800x',
      fields: [{ key: 'k', step: 1, label_en: 'L', label_mr: 'L', type: 't', text: 'a\u0000b' }],
    });
    expect((await send(wireMessage(wireBatch(), [form]))).status).toBe(200);
    expect(await application(form.id)).toMatchObject({ name: 'Asha �x', fields: [expect.objectContaining({ text: 'ab' })] });
  });

  it('keys Sarthi does not know are ignored', async () => {
    const form = wireApplication({ future: { a: 1 } });
    expect((await send({ ...wireMessage(wireBatch(), [form]), extra: true })).status).toBe(200);
    expect(await application(form.id)).not.toHaveProperty('future');
  });
});

describe('the database keeps impossible states out', () => {
  let id: string;
  beforeEach(async () => {
    [id] = await submit(app, wireBatch({ district: NASHIK }), [wireApplication()]);
  });

  it.each([
    [`"stage" = 'NOWHERE'`],
    [`"stage" = 'APPROVED', "stageEvent" = 'APPROVED'`],
    [`"stage" = 'COEP', "stageEvent" = 'APPROVED'`],
    [`"stageEvent" = 'APPROVED'`],
    [`"aadhaarMasked" = '1234-5678-9012'`],
    [`"reached" = 4`],
  ])('an application with %s', async (set) => {
    await expect(AppDataSource.query(`UPDATE "ipp_applications" SET ${set} WHERE "id" = $1`, [id])).rejects.toThrow(/CHK_ipp_applications/);
  });

  it('the history is append-only', async () => {
    await expect(AppDataSource.query(`UPDATE "ipp_approval_events" SET "byName" = 'x'`)).rejects.toThrow(/append-only/);
    await expect(AppDataSource.query(`DELETE FROM "ipp_approval_events"`)).rejects.toThrow(/append-only/);
  });

  it.each([
    ['a jump', `'APPROVED', 'DIVISION', 'APPROVED', NULL`],
    ['a rejection of two levels', `'REJECTED', 'COEP', 'AUDITOR', 'a good reason'`],
    ['a rejection without a reason', `'REJECTED', 'COEP', 'DIVISION', NULL`],
    ['a blank reason', `'REJECTED', 'COEP', 'DIVISION', '     '`],
    ['an approval with a reason', `'APPROVED', 'DIVISION', 'COEP', 'why'`],
  ])('an event of %s', async (_name, values) => {
    const user = (await divisionalOfficer([])).user;
    await expect(
      AppDataSource.query(
        `INSERT INTO "ipp_approval_events" ("applicationId", "event", "fromStage", "toStage", "reason", "byUserId", "byName") VALUES ($1, ${values}, $2, 'x')`,
        [id, user.id],
      ),
    ).rejects.toThrow(/CHK_ipp_approval_events/);
  });

  it('a decision that is no move of the contract', async () => {
    await expect(
      AppDataSource.query(
        `INSERT INTO "ipp_decisions" ("applicationId", "action", "fromStage", "toStage", "byName", "byRole", "decidedAt")
         VALUES ($1, 'APPROVE', 'DIVISION', 'APPROVED', 'x', 'x', now())`,
        [id],
      ),
    ).rejects.toThrow(/CHK_ipp_decisions_move/);
    expect(await stageOf(id)).toBe('DIVISION');
  });
});
