import { randomUUID } from 'crypto';
import type { Express } from 'express';
import {
  IppApplicationDetailDto,
  IppApplicationRowDto,
  IppBatchDto,
  IppDashboardDto,
  IppDecidedManyDto,
  IppSummaryDto,
} from '../../../src/modules/ipp-approvals/ipp-approvals.openapi';
import { envelope, pagedEnvelope } from '../../../src/shared/openapi/registry';
import {
  audits,
  decisions,
  divisionalOfficer,
  events,
  ippCall,
  MESSAGES,
  NASHIK,
  resetIpp,
  restoreLink,
  seedDistricts,
  signedIn,
  stageOf,
  submit,
  switchLink,
  wireApplication,
  wireBatch,
  wireMessage,
} from '../../helpers/ipp';
import {
  actorWith,
  API,
  AppDataSource,
  auth,
  request,
  setupTestApp,
  superAdmin,
  teardownTestApp,
  type TestActor,
} from '../../helpers/test-app';

/* Reading and deciding (docs/ipp-approvals.md). The link is on only so that forms come in; nothing is sent in this file. */
const BASE = `${API}/ipp-approvals`;
let app: Express;
let districts: Record<'PUN' | 'NAS' | 'THA', string>;
let pune: TestActor;
let nashik: TestActor;
let coep: TestActor;
let head: TestActor;
let admin: TestActor;
let sumago: TestActor;
let viewer: TestActor;

beforeAll(async () => {
  app = await setupTestApp();
  districts = await seedDistricts();
  pune = await divisionalOfficer([districts.PUN], 'Officer Pune');
  nashik = await divisionalOfficer([districts.NAS], 'Officer Nashik');
  coep = await signedIn(['COEP'], 'Officer COEP');
  head = await signedIn(['HEAD_OFFICER'], 'Officer Head');
  admin = await superAdmin();
  sumago = await signedIn(['SUMAGO_SUPER_ADMIN'], 'Sumago Admin');
  viewer = await actorWith(['ipp-approvals.view']);
  switchLink(true);
});
afterAll(async () => {
  restoreLink();
  await teardownTestApp();
});
beforeEach(resetIpp);

const get = (who: TestActor, path: string) => request(app).get(`${BASE}${path}`).set(auth(who.token));
const post = (who: TestActor, path: string, body: object = {}) => request(app).post(`${BASE}${path}`).set(auth(who.token)).send(body);
/* Every approval has its reason, as every rejection has. */
const APPROVAL = 'Documents match the originals';
const approve = (who: TestActor, id: string, reason: unknown = APPROVAL) => post(who, `/applications/${id}/approve`, { reason } as object);
const reject = (who: TestActor, id: string, reason = 'The photo is not clear') => post(who, `/applications/${id}/reject`, { reason });
const headOffice = (enabled: boolean) => request(app).put(`${BASE}/head-office`).set(auth(admin.token)).send({ enabled });
const listed = async (who: TestActor, query = ''): Promise<string[]> => {
  const res = await get(who, `/applications?limit=100${query}`);
  expect(res.status).toBe(200);
  return (res.body.data as { id: string }[]).map((r) => r.id);
};
const check = (schema: { safeParse(v: unknown): { success: boolean; error?: { issues: unknown[] } } }, body: unknown) => {
  const r = schema.safeParse(body);
  if (!r.success) throw new Error(JSON.stringify(r.error!.issues.slice(0, 5), null, 2));
};
const one = async (district?: { code: string; name: string; state_code: string }): Promise<string> =>
  (await submit(app, wireBatch(district ? { district } : {}), [wireApplication()]))[0];

describe('the whole chain', () => {
  it('Head Office on: DIVISION → COEP → HEAD_OFFICE → APPROVED, each step with history and a message to IPP', async () => {
    const id = await one();
    let res = await approve(pune, id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id, stage: 'COEP', stageLabel: 'With COEP', canDecide: false, approveTo: null, rejectTo: null });
    res = await approve(coep, id);
    expect(res.body.data).toMatchObject({ stage: 'HEAD_OFFICE', stageLabel: 'With Head Office' });
    res = await approve(head, id);
    expect(res.body.data).toMatchObject({ stage: 'APPROVED', stageLabel: 'Final approved' });
    check(envelope(IppApplicationDetailDto), res.body);

    expect(
      (res.body.data.history as { event: string; from: string; to: string; by: string; role: string }[]).map((h) => [
        h.event,
        h.from,
        h.to,
        h.by,
        h.role,
      ]),
    ).toEqual([
      ['APPROVED', 'HEAD_OFFICE', 'APPROVED', 'Officer Head', 'Head Officer'],
      ['APPROVED', 'COEP', 'HEAD_OFFICE', 'Officer COEP', 'COEP'],
      ['APPROVED', 'DIVISION', 'COEP', 'Officer Pune', 'Divisional Officer'],
      ['RECEIVED', null, 'DIVISION', 'Synthetic Auditor', 'IPP Auditor'],
    ]);
    expect((await decisions(id)).map((d) => [d.action, d.fromStage, d.toStage, d.reason, d.byName, d.byRole, d.status])).toEqual([
      ['APPROVE', 'DIVISION', 'COEP', APPROVAL, 'Officer Pune', 'Divisional Officer', 'PENDING'],
      ['APPROVE', 'COEP', 'HEAD_OFFICE', APPROVAL, 'Officer COEP', 'COEP', 'PENDING'],
      ['APPROVE', 'HEAD_OFFICE', 'APPROVED', APPROVAL, 'Officer Head', 'Head Officer', 'PENDING'],
    ]);
    const trail = await audits('ipp.application.approve');
    expect(trail.map((a) => [a.actorUserId, a.resourceId, a.details])).toEqual([
      [pune.user.id, id, { from: 'DIVISION', to: 'COEP' }],
      [coep.user.id, id, { from: 'COEP', to: 'HEAD_OFFICE' }],
      [head.user.id, id, { from: 'HEAD_OFFICE', to: 'APPROVED' }],
    ]);
    expect(JSON.stringify(trail)).not.toMatch(/Asha|example\.invalid/);
  });

  it.each(['SUPER_ADMIN', 'SUMAGO_SUPER_ADMIN'])('Head Office off: COEP → SUPER_ADMIN → APPROVED by %s', async (role) => {
    await headOffice(false);
    const id = await one();
    await approve(pune, id);
    expect((await approve(coep, id)).body.data.stage).toBe('SUPER_ADMIN');
    /* The Head Officer reads it (it is at the final level) and decides nothing. */
    expect((await get(head, `/applications/${id}`)).body.data.canDecide).toBe(false);
    expect((await approve(head, id)).body.error.code).toBe('NOT_YOURS_TO_DECIDE');
    const boss = role === 'SUPER_ADMIN' ? admin : sumago;
    const res = await approve(boss, id);
    expect(res.status).toBe(200);
    expect(res.body.data.stage).toBe('APPROVED');
    expect((await decisions(id)).at(-1)).toMatchObject({
      action: 'APPROVE',
      fromStage: 'SUPER_ADMIN',
      toStage: 'APPROVED',
      byRole: 'Super Admin',
    });
  });

  it('nothing is decided after the final approval', async () => {
    const id = await one();
    await approve(pune, id);
    await approve(coep, id);
    await approve(head, id);
    for (const who of [pune, coep, head, admin]) {
      expect((await approve(who, id)).status).toBe(409);
      expect((await reject(who, id)).status).toBe(409);
    }
    expect(await stageOf(id)).toBe('APPROVED');
  });
});

describe('rejection: one level back, with a reason', () => {
  it('Divisional Officer → Auditor; the corrected form comes back to DIVISION', async () => {
    const batch = wireBatch();
    const form = wireApplication();
    const [id] = await submit(app, batch, [form]);
    const res = await reject(pune, id, '  The photo is not clear  ');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      stage: 'AUDITOR',
      canDecide: false,
      lastEvent: { event: 'REJECTED', from: 'DIVISION', to: 'AUDITOR', reason: 'The photo is not clear' },
    });
    expect((await decisions(id))[0]).toMatchObject({
      action: 'REJECT',
      fromStage: 'DIVISION',
      toStage: 'AUDITOR',
      reason: 'The photo is not clear',
    });
    expect((await approve(pune, id)).status).toBe(409);

    await ippCall(app, 'POST', MESSAGES, wireMessage(batch, [{ ...form, action: 'RESUBMIT' }]));
    expect(await listed(pune)).toEqual([id]);
    expect((await approve(pune, id)).body.data.stage).toBe('COEP');
    const trail = await audits('ipp.application.reject');
    expect(trail).toHaveLength(1);
    expect(JSON.stringify(trail)).not.toContain('photo');
  });

  it('COEP → Divisional Officer, who decides again: approve, or one level further', async () => {
    const [a, b] = await submit(app, wireBatch(), [wireApplication(), wireApplication()]);
    for (const id of [a, b]) await approve(pune, id);
    for (const id of [a, b]) expect((await reject(coep, id)).body.data.stage).toBe('DIVISION');
    expect((await get(pune, '/summary')).body.data).toMatchObject({ toDecide: 2, sentBack: 2 });
    expect((await approve(pune, a)).body.data.stage).toBe('COEP');
    expect((await reject(pune, b)).body.data.stage).toBe('AUDITOR');
    expect((await decisions(b)).map((d) => [d.fromStage, d.toStage])).toEqual([
      ['DIVISION', 'COEP'],
      ['COEP', 'DIVISION'],
      ['DIVISION', 'AUDITOR'],
    ]);
  });

  it('Head Office → COEP, and Super Admin → COEP', async () => {
    const id = await one();
    await approve(pune, id);
    await approve(coep, id);
    expect((await reject(head, id)).body.data.stage).toBe('COEP');
    await headOffice(false);
    await approve(coep, id);
    const res = await reject(admin, id);
    expect(res.body.data.stage).toBe('COEP');
    expect((await decisions(id)).map((d) => [d.action, d.fromStage, d.toStage])).toEqual([
      ['APPROVE', 'DIVISION', 'COEP'],
      ['APPROVE', 'COEP', 'HEAD_OFFICE'],
      ['REJECT', 'HEAD_OFFICE', 'COEP'],
      ['APPROVE', 'COEP', 'SUPER_ADMIN'],
      ['REJECT', 'SUPER_ADMIN', 'COEP'],
    ]);
  });

  it('the other forms of the batch go on', async () => {
    const [a, b] = await submit(app, wireBatch(), [wireApplication(), wireApplication()]);
    await reject(pune, a);
    expect((await approve(pune, b)).body.data.stage).toBe('COEP');
  });

  it.each([
    ['none', {}],
    ['not text', { reason: 5 }],
    ['too short after trimming', { reason: '  ab  ' }],
    ['one picture', { reason: '\u{1F600}a' }],
    ['501 characters', { reason: 'a'.repeat(501) }],
    ['only control characters', { reason: '\u0000\u0001\u0002\u0003' }],
    ['another key', { reason: 'good reason', stage: 'COEP' }],
  ])('a reason is 3–500 characters: %s → 422', async (_name, body) => {
    const id = await one();
    const res = await post(pune, `/applications/${id}/reject`, body);
    expect(res.status).toBe(422);
    expect(await stageOf(id)).toBe('DIVISION');
  });

  it('a reason of exactly 3 and of exactly 500 characters is taken, in any script', async () => {
    const [a, b] = await submit(app, wireBatch(), [wireApplication(), wireApplication()]);
    expect((await reject(pune, a, 'फोटो')).status).toBe(200);
    expect((await reject(pune, b, `x${'\u{1F600}'.repeat(249)}y`)).status).toBe(200);
    expect((await events(b)).at(-1)!.reason).toHaveLength(500);
  });
});

describe('approval reason: asked on a second approval, as a rejection always has one', () => {
  const BAD: [string, object][] = [
    ['not text', { reason: 5 }],
    ['too short after trimming', { reason: '  ab  ' }],
    ['501 characters', { reason: 'a'.repeat(501) }],
    ['only control characters', { reason: '\u0000\u0001\u0002\u0003' }],
  ];
  /* At DIVISION again: the Divisional Officer approved it, COEP rejected it back. */
  const backAtDivision = async (): Promise<string> => {
    const id = await one();
    await approve(pune, id);
    await reject(coep, id, 'Marks do not match');
    return id;
  };

  it.each(BAD)('a reason that is given: %s → 422, nothing decided (one, several, a batch)', async (_name, body) => {
    const id = await one();
    expect((await post(pune, `/applications/${id}/approve`, body)).status).toBe(422);
    expect((await post(pune, '/approve', { ids: [id], ...body })).status).toBe(422);
    const batchId = ((await get(pune, '/batches')).body.data as { id: string }[])[0].id;
    expect((await post(pune, `/batches/${batchId}/approve`, body)).status).toBe(422);
    expect(await stageOf(id)).toBe('DIVISION');
    expect(await decisions(id)).toEqual([]);
  });

  it('a first approval needs none: approved without a reason, nothing asked', async () => {
    const id = await one();
    expect((await get(pune, `/applications/${id}`)).body.data).toMatchObject({ canDecide: true, reasonRequired: false });
    const res = await post(pune, `/applications/${id}/approve`, {});
    expect(res.status).toBe(200);
    check(envelope(IppApplicationDetailDto), res.body);
    expect(res.body.data.history[0]).toMatchObject({ event: 'APPROVED', reason: null });
    expect((await decisions(id))[0]).toMatchObject({ action: 'APPROVE', reason: null });
    const [a, b] = await submit(app, wireBatch(), [wireApplication(), wireApplication()]);
    expect((await post(pune, '/approve', { ids: [a, b] })).body.data.approved).toBe(2);
  });

  it('a second approval needs the reason: 422 without it, nothing decided; then kept in the history and sent to IPP', async () => {
    const id = await backAtDivision();
    const listedRow = ((await get(pune, '/applications?limit=100')).body.data as { id: string; reasonRequired: boolean }[]).find(
      (r) => r.id === id,
    )!;
    expect(listedRow.reasonRequired).toBe(true);
    expect((await get(pune, `/applications/${id}`)).body.data).toMatchObject({ canDecide: true, reasonRequired: true });
    const res = await post(pune, `/applications/${id}/approve`, {});
    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual([
      { field: 'body.reason', message: 'Approval reason is required: the application was rejected before, so this is its second approval.' },
    ]);
    expect(await stageOf(id)).toBe('DIVISION');

    const ok = await approve(pune, id, '  Marks corrected and checked  ');
    expect(ok.status).toBe(200);
    expect(ok.body.data.history[0]).toMatchObject({
      event: 'APPROVED',
      from: 'DIVISION',
      to: 'COEP',
      reason: 'Marks corrected and checked',
      by: 'Officer Pune',
      role: 'Divisional Officer',
    });
    expect((await decisions(id)).at(-1)).toMatchObject({ action: 'APPROVE', reason: 'Marks corrected and checked' });
    /* Free text stays out of the audit, as a rejection's. */
    expect(JSON.stringify(await audits('ipp.application.approve'))).not.toContain('Marks corrected');
    /* COEP rejected it before: COEP's approval now is a second one too. */
    expect((await get(coep, `/applications/${id}`)).body.data.reasonRequired).toBe(true);
    expect((await post(coep, `/applications/${id}/approve`, {})).status).toBe(422);
    expect((await approve(coep, id, 'Correction accepted')).body.data.stage).toBe('HEAD_OFFICE');
    /* Head Office sees it for the first time: no reason needed. */
    expect((await get(head, `/applications/${id}`)).body.data.reasonRequired).toBe(false);
    expect((await post(head, `/applications/${id}/approve`, {})).status).toBe(200);
  });

  it('several forms and a whole batch: one reason when any of them is a second approval, kept for each', async () => {
    const again = await backAtDivision();
    const [fresh] = await submit(app, wireBatch(), [wireApplication()]);
    const without = await post(pune, '/approve', { ids: [again, fresh] });
    expect(without.status).toBe(422);
    expect(without.body.error.details[0].message).toBe(
      'Approval reason is required: 1 of these applications were rejected before, so this is their second approval.',
    );
    expect(await decisions(fresh)).toEqual([]);
    expect((await post(pune, '/approve', { ids: [again, fresh], reason: 'Checked in the district office' })).body.data.approved).toBe(2);
    for (const id of [again, fresh]) expect((await events(id)).at(-1)).toMatchObject({ event: 'APPROVED', reason: 'Checked in the district office' });
    expect(JSON.stringify(await audits('ipp.application.approve-many'))).not.toContain('district office');

    const batchAgain = await backAtDivision();
    const batchId = ((await get(pune, `/applications/${batchAgain}`)).body.data as { batch: { id: string } }).batch.id;
    expect((await post(pune, `/batches/${batchId}/approve`, {})).status).toBe(422);
    expect((await post(pune, `/batches/${batchId}/approve`, { reason: 'Whole batch checked' })).body.data.approved).toBeGreaterThan(0);
    expect((await events(batchAgain)).at(-1)).toMatchObject({ event: 'APPROVED', reason: 'Whole batch checked' });
    expect(JSON.stringify(await audits('ipp.batch.approve'))).not.toContain('Whole batch');
  });
});

describe('who sees what', () => {
  it('a Divisional Officer sees and decides only the forms of batches of their districts, whatever the form says', async () => {
    const inPune = await one();
    const inNashik = await one(NASHIK);
    expect(await listed(pune, '&view=ALL')).toEqual([inPune]);
    expect(await listed(nashik, '&view=ALL')).toEqual([inNashik]);
    /* The form itself says Pune; the batch is of Nashik. */
    expect((await get(nashik, `/applications/${inNashik}`)).body.data).toMatchObject({
      formDistrict: 'Pune',
      district: { id: districts.NAS, name: 'Nashik' },
    });

    for (const path of [`/applications/${inNashik}`, `/applications/${inNashik}/documents/AADHAAR_CARD`]) {
      const res = await get(pune, path);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    expect((await approve(pune, inNashik)).status).toBe(404);
    expect((await reject(pune, inNashik)).status).toBe(404);
    const bulk = await post(pune, '/approve', { reason: APPROVAL, ids: [inPune, inNashik] });
    expect(bulk.body.data).toEqual({ approved: 1, skipped: 1, applications: [{ id: inPune, stage: 'COEP', stageLabel: 'With COEP' }] });
    expect(await stageOf(inNashik)).toBe('DIVISION');
    /* A filter of somebody else's district or batch opens nothing. */
    expect(await listed(pune, `&view=ALL&districtId=${districts.NAS}`)).toEqual([]);
    /* What is no id at all is 422, an unknown id is 404. */
    expect((await get(pune, '/applications/not-an-id')).status).toBe(422);
    expect((await get(pune, `/applications/${randomUUID()}`)).status).toBe(404);
  });

  it('an officer of two districts sees both; a district taken away takes the forms away', async () => {
    const both = await divisionalOfficer([districts.PUN, districts.NAS]);
    const a = await one();
    const b = await one(NASHIK);
    expect((await listed(both)).sort()).toEqual([a, b].sort());
    await AppDataSource.query(`UPDATE "user_districts" SET "isDelete" = true WHERE "userId" = $1 AND "districtId" = $2`, [
      both.user.id,
      districts.NAS,
    ]);
    expect(await listed(both, '&view=ALL')).toEqual([a]);
    const none = await divisionalOfficer([]);
    expect(await listed(none, '&view=ALL')).toEqual([]);
  });

  it('COEP sees what reached COEP at least once, the Head Officer what reached the final level', async () => {
    const batch = wireBatch();
    const [waiting, atCoep, sentBack, final] = await submit(app, batch, [
      wireApplication(),
      wireApplication(),
      wireApplication(),
      wireApplication(),
    ]);
    for (const id of [atCoep, sentBack, final]) await approve(pune, id);
    await reject(coep, sentBack);
    await approve(coep, final);
    expect((await listed(coep, '&view=ALL')).sort()).toEqual([atCoep, sentBack, final].sort());
    expect(await listed(head, '&view=ALL')).toEqual([final]);
    expect((await get(coep, `/applications/${waiting}`)).status).toBe(404);
    expect((await get(head, `/applications/${atCoep}`)).status).toBe(404);
    await reject(head, final);
    /* Back at COEP, but it has been at the final level. */
    expect(await listed(head, '&view=ALL')).toEqual([final]);
    expect((await get(head, `/applications/${final}`)).body.data).toMatchObject({ stage: 'COEP', canDecide: false });
    /* The batch is seen when one of its forms is, with the numbers of what is seen. */
    const res = await get(head, '/batches');
    expect(res.body.data).toEqual([expect.objectContaining({ code: batch.code, students: 1, toDecide: 0 })]);
    expect((await get(viewer, '/batches')).body.data[0]).toMatchObject({ students: 4 });
  });

  it('Super Admins and a user with view alone read everything and decide nothing', async () => {
    const id = await one();
    for (const who of [admin, sumago, viewer]) {
      expect(await listed(who, '&view=ALL')).toEqual([id]);
      expect(await listed(who)).toEqual([]);
      expect((await get(who, `/applications/${id}`)).body.data).toMatchObject({ canDecide: false, approveTo: null, rejectTo: null });
    }
    for (const who of [admin, sumago]) {
      expect((await approve(who, id)).body.error.code).toBe('NOT_YOURS_TO_DECIDE');
      expect((await reject(who, id)).status).toBe(409);
      expect((await post(who, '/approve', { reason: APPROVAL, ids: [id] })).body.data).toEqual({ approved: 0, skipped: 1, applications: [] });
    }
    expect((await approve(viewer, id)).status).toBe(403);
    expect(await stageOf(id)).toBe('DIVISION');
  });

  it('a Super Admin decides at no level but their own, not even with an officer role next to it', async () => {
    const both = await signedIn(['SUPER_ADMIN', 'DIVISIONAL_OFFICER', 'COEP', 'HEAD_OFFICER']);
    await AppDataSource.query(`INSERT INTO "user_districts" ("userId", "districtId") VALUES ($1, $2)`, [both.user.id, districts.PUN]);
    const id = await one();
    expect((await approve(both, id)).status).toBe(409);
    await approve(pune, id);
    expect((await approve(both, id)).status).toBe(409);
    await approve(coep, id);
    expect((await approve(both, id)).status).toBe(409);
    await headOffice(false);
    expect((await approve(both, id)).body.data.stage).toBe('APPROVED');
  });

  it('with two permissions one sees and decides all that each allows', async () => {
    const both = await signedIn(['DIVISIONAL_OFFICER', 'COEP']);
    await AppDataSource.query(`INSERT INTO "user_districts" ("userId", "districtId") VALUES ($1, $2)`, [both.user.id, districts.PUN]);
    const mine = await one();
    const other = await one(NASHIK);
    expect(await listed(both, '&view=ALL')).toEqual([mine]);
    await approve(nashik, other);
    expect((await listed(both)).sort()).toEqual([mine, other].sort());
    expect((await get(both, '/summary')).body.data).toMatchObject({ stages: ['DIVISION', 'COEP'], districts: null, toDecide: 2 });
    /* One level per decision. */
    expect((await approve(both, mine)).body.data.stage).toBe('COEP');
    await reject(both, other);
    /* Of another district: not at DIVISION for them, below their level there. */
    expect(await listed(both, '&view=SENT_BACK')).toEqual([other]);
  });
});

describe('dashboard figures (GET /dashboard)', () => {
  /* A day relative to today where the programme runs (APP_TIMEZONE, Asia/Kolkata in the tests). */
  const day = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' });
  const finalApprove = async (id: string, officer: TestActor) => {
    for (const who of [officer, coep, head]) expect((await approve(who, id)).status).toBe(200);
  };

  it('counts the pipeline, the batches, the candidates in training and the courses', async () => {
    const running = wireBatch({ start_date: day(-10), end_date: day(30), status: 'ONGOING', started_at: `${day(-10)}T04:30:00.000Z` });
    const ended = wireBatch({
      district: NASHIK,
      start_date: day(-90),
      end_date: day(-1),
      status: 'ENDED',
      started_at: `${day(-90)}T04:30:00.000Z`,
      ended_at: `${day(-1)}T11:30:00.000Z`,
      technology: { code: 'T05', name: 'Cyber Security' },
    });
    const later = wireBatch({ start_date: day(5), end_date: day(60), technology: null });
    const undated = wireBatch({ start_date: null, end_date: null });
    const [a1, a2] = await submit(app, running, [wireApplication(), wireApplication(), wireApplication()]);
    const [b1, b2] = await submit(app, ended, [wireApplication(), wireApplication()]);
    await submit(app, later, [wireApplication()]);
    await submit(app, undated, [wireApplication()]);
    await finalApprove(a1, pune);
    expect((await approve(pune, a2)).status).toBe(200);
    await finalApprove(b1, nashik);
    expect((await reject(nashik, b2)).status).toBe(200);

    const res = await get(head, '/dashboard');
    expect(res.status).toBe(200);
    check(envelope(IppDashboardDto), res.body);
    expect(res.body.data).toEqual({
      districts: null,
      pipeline: { received: 7, auditorApproved: 6, divisionApproved: 3, coepApproved: 2, finalApproved: 2 },
      /* Running: started and not ended. Not the one that starts later, the one that ended, or one without dates. */
      /* Ongoing and ended as IPP sends them (the Auditor starts and ends a batch), whatever its planned dates. */
      batches: { total: 4, ongoing: 1, ended: 1 },
      inTraining: 1,
      courses: [
        { name: 'Web Design & Development', applications: 4, enrolled: 1 },
        { name: 'Cyber Security', applications: 2, enrolled: 1 },
        { name: 'Course not set', applications: 1, enrolled: 0 },
      ],
    });
    /* Counts only: the COEP, the Super Admin and a viewer read the whole programme too. */
    for (const who of [coep, admin, viewer]) expect((await get(who, '/dashboard')).body.data).toEqual(res.body.data);

    /* A Divisional Officer: the figures of their districts. */
    expect((await get(pune, '/dashboard')).body.data).toEqual({
      districts: [{ id: districts.PUN, name: 'Pune' }],
      pipeline: { received: 5, auditorApproved: 5, divisionApproved: 2, coepApproved: 1, finalApproved: 1 },
      batches: { total: 3, ongoing: 1, ended: 0 },
      inTraining: 1,
      courses: [
        { name: 'Web Design & Development', applications: 4, enrolled: 1 },
        { name: 'Course not set', applications: 1, enrolled: 0 },
      ],
    });
    expect((await get(nashik, '/dashboard')).body.data).toMatchObject({
      pipeline: { received: 2, auditorApproved: 1, divisionApproved: 1, coepApproved: 1, finalApproved: 1 },
      batches: { total: 1, ongoing: 0, ended: 1 },
      inTraining: 0,
    });
  });

  it('is empty for a Divisional Officer without districts, and needs the view permission', async () => {
    await submit(app, wireBatch(), [wireApplication()]);
    const none = await divisionalOfficer([], 'Officer Nowhere');
    expect((await get(none, '/dashboard')).body.data).toEqual({
      districts: [],
      pipeline: { received: 0, auditorApproved: 0, divisionApproved: 0, coepApproved: 0, finalApproved: 0 },
      batches: { total: 0, ongoing: 0, ended: 0 },
      inTraining: 0,
      courses: [],
    });
    const outsider = await actorWith(['ipp-officers.view']);
    expect((await get(outsider, '/dashboard')).status).toBe(403);
  });
});

describe('summary, lists and detail', () => {
  it('summary: what I decide, my districts and the counts of what I see', async () => {
    const [a] = await submit(app, wireBatch(), [wireApplication(), wireApplication(), wireApplication()]);
    await approve(pune, a);
    let res = await get(pune, '/summary');
    check(envelope(IppSummaryDto), res.body);
    expect(res.body.data).toEqual({
      stages: ['DIVISION'],
      districts: [{ id: districts.PUN, name: 'Pune' }],
      headOfficeEnabled: true,
      toDecide: 2,
      sentBack: 0,
      counts: { AUDITOR: 0, DIVISION: 2, COEP: 1, HEAD_OFFICE: 0, SUPER_ADMIN: 0, APPROVED: 0 },
      views: { TO_DECIDE: 2, SENT_ON: 1, SENT_BACK: 0, ALL: 3 },
    });
    res = await get(coep, '/summary');
    expect(res.body.data).toMatchObject({ stages: ['COEP'], districts: null, toDecide: 1, counts: { DIVISION: 0, COEP: 1 } });
    expect((await get(head, '/summary')).body.data).toMatchObject({ stages: ['HEAD_OFFICE'], toDecide: 0 });
    expect((await get(admin, '/summary')).body.data).toMatchObject({ stages: [], counts: { DIVISION: 2, COEP: 1 } });
    await headOffice(false);
    expect((await get(head, '/summary')).body.data).toMatchObject({ stages: [], headOfficeEnabled: false });
    expect((await get(admin, '/summary')).body.data).toMatchObject({ stages: ['SUPER_ADMIN'] });
  });

  it('summary.districts: a list only for a user limited to districts (empty when none is assigned), null for everyone else', async () => {
    const districtsOf = async (who: TestActor) => (await get(who, '/summary')).body.data.districts;
    expect(await districtsOf(await divisionalOfficer([]))).toEqual([]);
    expect(await districtsOf(await divisionalOfficer([districts.THA, districts.NAS]))).toEqual([
      { id: districts.NAS, name: 'Nashik' },
      { id: districts.THA, name: 'Thane' },
    ]);
    for (const who of [coep, head, admin, sumago, viewer]) expect(await districtsOf(who)).toBeNull();
    for (const roles of [
      ['DIVISIONAL_OFFICER', 'COEP'],
      ['DIVISIONAL_OFFICER', 'HEAD_OFFICER'],
      ['DIVISIONAL_OFFICER', 'SUPER_ADMIN'],
    ]) {
      const both = await signedIn(roles);
      await AppDataSource.query(`INSERT INTO "user_districts" ("userId", "districtId") VALUES ($1, $2)`, [both.user.id, districts.PUN]);
      expect(await districtsOf(both)).toBeNull();
    }
  });

  it('views: TO_DECIDE (default), SENT_ON, SENT_BACK, ALL', async () => {
    const batch = wireBatch();
    const forms = Array.from({ length: 5 }, () => wireApplication());
    const [toDecide, sentOn, sentBack, approved, corrected] = await submit(app, batch, forms);
    for (const id of [sentOn, approved, sentBack]) await approve(pune, id);
    await approve(coep, approved);
    await approve(head, approved);
    await reject(coep, sentBack);
    await reject(pune, corrected);
    expect((await listed(pune)).sort()).toEqual([toDecide, sentBack].sort());
    expect((await listed(pune, '&view=SENT_ON')).sort()).toEqual([sentOn, approved].sort());
    expect(await listed(pune, '&view=SENT_BACK')).toEqual([corrected]);
    expect((await listed(pune, '&view=ALL')).sort()).toEqual([toDecide, sentOn, sentBack, approved, corrected].sort());
    /* The summary counts each list the same way. */
    expect((await get(pune, '/summary')).body.data.views).toEqual({ TO_DECIDE: 2, SENT_ON: 2, SENT_BACK: 1, ALL: 5 });
    expect((await get(coep, '/summary')).body.data.views).toEqual({ TO_DECIDE: 1, SENT_ON: 1, SENT_BACK: 1, ALL: 3 });
    expect((await get(viewer, '/summary')).body.data.views).toMatchObject({ TO_DECIDE: 0, SENT_ON: 0, SENT_BACK: 0 });
    expect(await listed(coep)).toEqual([sentOn]);
    expect(await listed(coep, '&view=SENT_BACK')).toEqual([sentBack]);
    expect(await listed(coep, '&view=SENT_ON')).toEqual([approved]);
    /* A correction moves nothing: it is still "sent back". After the form came back it is not. */
    const form = forms[4];
    await ippCall(app, 'POST', MESSAGES, wireMessage(batch, [{ ...form, action: 'UPDATE' }]));
    expect(await listed(pune, '&view=SENT_BACK')).toEqual([corrected]);
    /* …and does not hide why, in the list and in the detail; the history has both. */
    const row = (await get(pune, '/applications?view=SENT_BACK')).body.data[0];
    expect(row.lastEvent).toMatchObject({ event: 'REJECTED', from: 'DIVISION', to: 'AUDITOR', reason: 'The photo is not clear' });
    const detail = (await get(pune, `/applications/${corrected}`)).body.data;
    expect(detail.lastEvent).toEqual(row.lastEvent);
    expect((detail.history as { event: string }[]).map((h) => h.event)).toEqual(['CORRECTED', 'REJECTED', 'RECEIVED']);
    await ippCall(app, 'POST', MESSAGES, wireMessage(batch, [{ ...form, action: 'RESUBMIT' }]));
    expect(await listed(pune, '&view=SENT_BACK')).toEqual([]);
    expect((await get(pune, '/summary')).body.data).toMatchObject({ toDecide: 3, sentBack: 1 });
    /* Nothing is above or below somebody without a level. */
    expect(await listed(viewer, '&view=SENT_ON')).toEqual([]);
    expect(await listed(viewer, '&view=SENT_BACK')).toEqual([]);
  });

  it('filters, search (literally), sorting and paging; the rows are the documented ones', async () => {
    const batch = wireBatch();
    const forms = [
      wireApplication({ name: 'Charu Alpha', registration_id: 'IPP-900001', mobile_number: '9000000001', email: 'one@example.invalid' }),
      wireApplication({ name: 'asha Beta', registration_id: 'IPP-900002', mobile_number: '9000000002', email: 'two@example.invalid' }),
      wireApplication({ name: 'Bina 100%', registration_id: 'IPP-900003', mobile_number: '9000000003', email: 'three@example.invalid' }),
    ];
    const [charu, asha, bina] = await submit(app, batch, forms);
    const other = await one();
    await approve(pune, other);
    const { body } = await get(pune, '/batches');
    const batchId = (body.data as { id: string; code: string }[]).find((b) => b.code === batch.code)!.id;

    expect(await listed(pune, `&view=ALL&batchId=${batchId}&sortBy=name&sortOrder=ASC`)).toEqual([asha, bina, charu]);
    expect(await listed(pune, `&view=ALL&batchId=${batchId}&sortBy=registrationId&sortOrder=DESC`)).toEqual([bina, asha, charu]);
    expect(await listed(pune, '&view=ALL&stage=COEP')).toEqual([other]);
    expect(await listed(pune, `&view=ALL&districtId=${districts.PUN}&search=ASHA beta`)).toEqual([asha]);
    expect(await listed(pune, '&search=900003')).toEqual([bina]);
    expect(await listed(pune, '&search=9000000001')).toEqual([charu]);
    expect(await listed(pune, '&search=two@example')).toEqual([asha]);
    expect(await listed(pune, `&search=${encodeURIComponent('100%')}`)).toEqual([bina]);
    expect(await listed(pune, `&search=${encodeURIComponent('%')}&batchId=${batchId}`)).toEqual([bina]);

    const page = await get(pune, `/applications?view=ALL&batchId=${batchId}&sortBy=name&sortOrder=ASC&limit=2&page=2`);
    expect(page.body.meta).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
    expect((page.body.data as { id: string }[]).map((r) => r.id)).toEqual([charu]);
    check(pagedEnvelope(IppApplicationRowDto), page.body);
    expect(page.body.data[0]).toMatchObject({
      registrationId: 'IPP-900001',
      documents: { uploaded: 2, verified: 1 },
      batch: { id: batchId, code: batch.code, name: batch.name },
      canDecide: true,
      lastEvent: { event: 'RECEIVED', from: null, to: 'DIVISION', by: 'Synthetic Auditor', role: 'IPP Auditor', reason: null },
    });
    expect(page.headers['cache-control']).toBe('private, no-store');

    for (const bad of ['view=MINE', 'stage=NOWHERE', 'batchId=1', 'districtId=x', 'sortBy=email', 'sortOrder=UP', 'limit=101', 'page=0'])
      expect((await get(pune, `/applications?${bad}`)).status).toBe(422);
  });

  it('detail: the form, the documents, the corrections and where my decision would send it', async () => {
    const edits = [{ at: '2026-11-25T06:00:00+05:30', by: null, changes: [{ key: 'full_name', label: 'Full name', from: 'A', to: 'B' }] }];
    const form = wireApplication({ edits, aadhaar_masked: 'xxxx xxxx 4321' });
    const [id] = await submit(app, wireBatch(), [form]);
    const res = await get(pune, `/applications/${id}`);
    check(envelope(IppApplicationDetailDto), res.body);
    expect(res.body.data).toMatchObject({
      aadhaarMasked: 'XXXX-XXXX-4321',
      submittedAt: '2026-11-20T10:00:00.000Z',
      auditor: { approvedAt: '2026-11-24T10:00:00.000Z', by: 'Synthetic Auditor' },
      approveTo: { stage: 'COEP', label: 'With COEP' },
      rejectTo: { stage: 'AUDITOR', label: 'With IPP Auditor' },
      edits: [{ at: '2026-11-25T00:30:00.000Z', by: null, changes: edits[0].changes }],
    });
    expect(res.body.data.fields[0]).toEqual({
      key: 'full_name',
      step: 1,
      labelEn: 'Full name',
      labelMr: 'पूर्ण नाव',
      type: 'text',
      text: form.fields[0].text,
    });
    expect(res.body.data.documentList[0]).toEqual({
      code: 'AADHAAR_CARD',
      name: 'Aadhaar card',
      nameMr: 'आधार कार्ड',
      required: true,
      kind: 'DOCUMENT',
      file: { name: 'आधार card.pdf', mime: 'application/pdf', size: 12, uploadedAt: '2026-11-20T09:00:00.000Z' },
      verified: true,
      verifiedAt: '2026-11-24T09:00:00.000Z',
      verifiedBy: 'Synthetic Auditor',
    });
    await approve(pune, id);
    expect((await get(coep, `/applications/${id}`)).body.data.approveTo).toEqual({ stage: 'HEAD_OFFICE', label: 'With Head Office' });
    await headOffice(false);
    expect((await get(coep, `/applications/${id}`)).body.data.approveTo).toEqual({ stage: 'SUPER_ADMIN', label: 'With Super Admin' });
  });

  it('batches: scoped, with the numbers of what I see', async () => {
    const first = wireBatch({ name: 'Alpha', centre: { code: 'CTR-77', name: 'Blue Centre' }, technology: null, start_date: null });
    const [a, b] = await submit(app, first, [wireApplication(), wireApplication()]);
    const second = wireBatch({ name: 'beta', district: NASHIK, delivery_mode: 'ONLINE' });
    await submit(app, second, [wireApplication()]);
    await approve(pune, a);

    let res = await get(pune, '/batches');
    check(pagedEnvelope(IppBatchDto), res.body);
    expect(res.body.data).toEqual([
      {
        id: expect.any(String),
        code: first.code,
        name: 'Alpha',
        district: { id: districts.PUN, name: 'Pune' },
        centre: { code: 'CTR-77', name: 'Blue Centre' },
        size: 30,
        startDate: null,
        endDate: '2027-02-28',
        deliveryMode: 'OFFLINE',
        technology: null,
        sentBy: 'Synthetic Auditor',
        receivedAt: expect.any(String),
        students: 2,
        stages: { AUDITOR: 0, DIVISION: 1, COEP: 1, HEAD_OFFICE: 0, SUPER_ADMIN: 0, APPROVED: 0 },
        toDecide: 1,
      },
    ]);
    const id = res.body.data[0].id as string;
    expect((await get(coep, `/batches/${id}`)).body.data).toMatchObject({ students: 1, toDecide: 1, stages: { DIVISION: 0, COEP: 1 } });
    expect((await get(nashik, `/batches/${id}`)).status).toBe(404);
    expect((await get(head, `/batches/${id}`)).status).toBe(404);
    res = await get(viewer, '/batches?sortBy=name&sortOrder=ASC');
    expect((res.body.data as { name: string }[]).map((x) => x.name)).toEqual(['Alpha', 'beta']);
    expect((await get(viewer, '/batches?search=blue')).body.data).toHaveLength(1);
    expect((await get(viewer, `/batches?search=${second.code}`)).body.meta.total).toBe(1);
    expect((await get(viewer, `/batches?districtId=${districts.NAS}`)).body.data[0].code).toBe(second.code);
    expect(b).toBeTruthy();
  });

  it('districts: the active ones', async () => {
    await AppDataSource.query(`UPDATE "districts" SET "isActive" = false WHERE "id" = $1`, [districts.THA]);
    expect((await get(viewer, '/districts')).body.data).toEqual([
      { id: districts.NAS, name: 'Nashik', code: 'NAS' },
      { id: districts.PUN, name: 'Pune', code: 'PUN' },
    ]);
    await AppDataSource.query(`UPDATE "districts" SET "isActive" = true WHERE "id" = $1`, [districts.THA]);
  });
});

describe('deciding many', () => {
  it('approves what is mine to decide now and skips the rest', async () => {
    const [a, b, c] = await submit(app, wireBatch(), [wireApplication(), wireApplication(), wireApplication()]);
    const other = await one(NASHIK);
    await approve(pune, c);
    const res = await post(pune, '/approve', { reason: APPROVAL, ids: [a, b, c, other, randomUUID()] });
    expect(res.status).toBe(200);
    check(envelope(IppDecidedManyDto), res.body);
    expect(res.body.data).toMatchObject({ approved: 2, skipped: 3 });
    expect((res.body.data.applications as { id: string }[]).map((x) => x.id).sort()).toEqual([a, b].sort());
    expect(await decisions()).toHaveLength(3);
    const [trail] = await audits('ipp.application.approve-many');
    expect(trail.details).toMatchObject({ approved: 2, skipped: 3 });
  });

  it('1–500 different ids', async () => {
    const id = await one();
    for (const body of [
      {},
      { reason: APPROVAL, ids: [] },
      { reason: APPROVAL, ids: ['x'] },
      { reason: APPROVAL, ids: [id, id] },
      { reason: APPROVAL, ids: [id, id.toUpperCase()] },
      { reason: APPROVAL, ids: Array.from({ length: 501 }, () => randomUUID()) },
      { ids: [id], reason: 'ok' },
    ])
      expect((await post(pune, '/approve', body)).status).toBe(422);
    const res = await post(pune, '/approve', { reason: APPROVAL, ids: [id, ...Array.from({ length: 499 }, () => randomUUID())] });
    expect(res.body.data).toMatchObject({ approved: 1, skipped: 499 });
  });

  it('a whole batch: everything of it that is mine to decide now', async () => {
    const batch = wireBatch();
    const [a, b, c] = await submit(app, batch, [wireApplication(), wireApplication(), wireApplication()]);
    await approve(pune, a);
    const batchId = ((await get(pune, '/batches')).body.data as { id: string }[])[0].id;
    let res = await post(pune, `/batches/${batchId}/approve`, { reason: APPROVAL });
    expect(res.body.data).toMatchObject({ approved: 2, skipped: 0 });
    expect((res.body.data.applications as { id: string }[]).map((x) => x.id).sort()).toEqual([b, c].sort());
    res = await post(coep, `/batches/${batchId}/approve`, { reason: APPROVAL });
    expect(res.body.data).toMatchObject({ approved: 3, skipped: 0 });
    expect((await post(coep, `/batches/${batchId}/approve`, { reason: APPROVAL })).body.data).toEqual({ approved: 0, skipped: 0, applications: [] });
    expect((await post(nashik, `/batches/${batchId}/approve`, { reason: APPROVAL })).status).toBe(404);
    expect((await post(pune, `/batches/${randomUUID()}/approve`, { reason: APPROVAL })).status).toBe(404);
    expect(await audits('ipp.batch.approve')).toHaveLength(2);
  });

  it('a retry with the same Idempotency-Key gets the first answer', async () => {
    const id = await one();
    const send = () => post(pune, '/approve', { reason: APPROVAL, ids: [id] }).set('Idempotency-Key', 'ipp-bulk-0001');
    const first = await send();
    expect(first.body.data.approved).toBe(1);
    await new Promise((r) => setTimeout(r, 200));
    const second = await send();
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.data).toEqual(first.body.data);
  });
});

describe('nobody decides twice', () => {
  it('two officers at the same moment: one decision, the other gets 409', async () => {
    const colleague = await divisionalOfficer([districts.PUN]);
    for (let i = 0; i < 3; i++) {
      const id = await one();
      const answers = await Promise.all([approve(pune, id), reject(colleague, id), approve(colleague, id), reject(pune, id)]);
      expect(answers.map((r) => r.status).sort()).toEqual([200, 409, 409, 409]);
      for (const r of answers) if (r.status === 409) expect(r.body.error.code).toBe('NOT_YOURS_TO_DECIDE');
      expect(await decisions(id)).toHaveLength(1);
      expect(await events(id)).toHaveLength(2);
    }
  });

  it('two bulk approvals of the same forms: every form once, and no deadlock', async () => {
    const colleague = await divisionalOfficer([districts.PUN]);
    const ids = await submit(
      app,
      wireBatch(),
      Array.from({ length: 30 }, () => wireApplication()),
    );
    const answers = await Promise.all([post(pune, '/approve', { reason: APPROVAL, ids }), post(colleague, '/approve', { reason: APPROVAL, ids: [...ids].reverse() })]);
    expect(answers.map((r) => r.status)).toEqual([200, 200]);
    expect(answers[0].body.data.approved + answers[1].body.data.approved).toBe(30);
    expect(await decisions()).toHaveLength(30);
  });

  it('a decision and its message to IPP are stored together or not at all', async () => {
    const id = await one();
    await AppDataSource.query(
      `ALTER TABLE "ipp_decisions" ADD CONSTRAINT "CHK_test_no_decision" CHECK ("byName" <> 'Officer Pune') NOT VALID`,
    );
    try {
      expect((await approve(pune, id)).status).toBe(400);
      expect(await stageOf(id)).toBe('DIVISION');
      expect(await events(id)).toHaveLength(1);
      expect(await audits('ipp.application.approve')).toHaveLength(0);
    } finally {
      await AppDataSource.query(`ALTER TABLE "ipp_decisions" DROP CONSTRAINT "CHK_test_no_decision"`);
    }
    expect((await approve(pune, id)).status).toBe(200);
  });
});

describe('the door', () => {
  const routes: ['get' | 'post' | 'put', string][] = [
    ['get', '/summary'],
    ['get', '/dashboard'],
    ['get', '/applications'],
    ['get', `/applications/${randomUUID()}`],
    ['get', `/applications/${randomUUID()}/documents/X`],
    ['get', '/batches'],
    ['get', `/batches/${randomUUID()}`],
    ['get', '/districts'],
    ['post', '/approve'],
    ['post', `/batches/${randomUUID()}/approve`],
    ['post', `/applications/${randomUUID()}/approve`],
    ['post', `/applications/${randomUUID()}/reject`],
    ['get', '/head-office'],
    ['put', '/head-office'],
    ['get', '/officers'],
    ['put', `/officers/${randomUUID()}/districts`],
    ['get', '/link'],
    ['post', '/link/retry'],
    ['post', '/link/test'],
  ];
  it.each(routes)('%s %s needs a session and the permission', async (method, path) => {
    expect((await request(app)[method](`${BASE}${path}`)).status).toBe(401);
    const outsider = await actorWith(['dashboard.view']);
    const res = await request(app)[method](`${BASE}${path}`).set(auth(outsider.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('an officer reaches neither the switch, the officers nor the link', async () => {
    for (const who of [pune, coep, head]) {
      expect((await get(who, '/head-office')).status).toBe(200);
      expect((await request(app).put(`${BASE}/head-office`).set(auth(who.token)).send({ enabled: false })).status).toBe(403);
      expect((await get(who, '/officers')).status).toBe(403);
      expect((await get(who, '/link')).status).toBe(403);
      expect((await post(who, '/link/retry')).status).toBe(403);
    }
  });

  it('the permission catalogue has both menus and their codes', async () => {
    const rows: { code: string; module: string }[] = await AppDataSource.query(
      `SELECT "code", "module" FROM "permissions" WHERE "module" IN ('ipp-approvals', 'ipp-officers') AND "isDelete" = false AND "isActive" = true`,
    );
    const codes = rows.map((r) => r.code);
    for (const code of ['view', 'division-officer', 'coep', 'head-office']) expect(codes).toContain(`ipp-approvals.${code}`);
    for (const code of ['view', 'update']) expect(codes).toContain(`ipp-officers.${code}`);
    const matrix = await request(app).get(`${API}/menu-visibility`).set(auth(admin.token));
    expect(matrix.body.data.menus).toEqual(expect.arrayContaining(['ipp-approvals', 'ipp-officers']));
  });

  it('the seeded roles hold exactly their rights', async () => {
    const rows: { code: string; perms: string[] }[] = await AppDataSource.query(
      `SELECT r."code", array_agg(p."code" ORDER BY p."code") AS "perms" FROM "roles" r
         JOIN "role_permissions" rp ON rp."roleId" = r."id" AND rp."isDelete" = false JOIN "permissions" p ON p."id" = rp."permissionId"
        WHERE r."code" IN ('DIVISIONAL_OFFICER', 'COEP', 'HEAD_OFFICER') GROUP BY r."code" ORDER BY r."code"`,
    );
    expect(rows).toEqual([
      { code: 'COEP', perms: ['ipp-approvals.coep', 'ipp-approvals.view'] },
      { code: 'DIVISIONAL_OFFICER', perms: ['ipp-approvals.division-officer', 'ipp-approvals.view'] },
      { code: 'HEAD_OFFICER', perms: ['ipp-approvals.head-office', 'ipp-approvals.view'] },
    ]);
  });
});
