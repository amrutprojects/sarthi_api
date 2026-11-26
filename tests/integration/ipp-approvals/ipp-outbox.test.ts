import { randomUUID } from 'crypto';
import type { Express } from 'express';
import { env } from '../../../src/config/env.config';
import { kickIppLink, runIppLinkCycle, startIppLinkPoller, stopIppLinkPoller } from '../../../src/modules/ipp-approvals';
import { OUTBOX_LOCK_KEY } from '../../../src/modules/ipp-approvals/ipp-approvals.constants';
import { IppLinkDto } from '../../../src/modules/ipp-approvals/ipp-approvals.openapi';
import { envelope } from '../../../src/shared/openapi/registry';
import {
  audits,
  decisions,
  divisionalOfficer,
  FakeIpp,
  IPP_SECRET,
  resetIpp,
  restoreLink,
  seedDistricts,
  signedIn,
  submit,
  switchLink,
  wireApplication,
  wireBatch,
  type WireDecision,
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

/* Sarthi → IPP: the decisions' outbox against a fake IPP (contract sections 3 and 4), and the link's page. */
const BASE = `${API}/ipp-approvals`;
const fake = new FakeIpp();
let app: Express;
let pune: TestActor;
let coep: TestActor;
let admin: TestActor;

beforeAll(async () => {
  app = await setupTestApp();
  const districts = await seedDistricts();
  pune = await divisionalOfficer([districts.PUN], 'Officer Pune');
  coep = await signedIn(['COEP'], 'Officer COEP');
  admin = await superAdmin();
  await fake.start();
});
afterAll(async () => {
  await stopIppLinkPoller();
  restoreLink();
  await fake.stop();
  await teardownTestApp();
});
beforeEach(async () => {
  fake.reset();
  switchLink(true, fake.url);
  await resetIpp();
});

const approve = (who: TestActor, id: string) => request(app).post(`${BASE}/applications/${id}/approve`).set(auth(who.token));
const reject = (who: TestActor, id: string, reason: string) =>
  request(app).post(`${BASE}/applications/${id}/reject`).set(auth(who.token)).send({ reason });
const link = async (who = admin) => {
  const res = await request(app).get(`${BASE}/link`).set(auth(who.token));
  expect(res.status).toBe(200);
  return res.body.data;
};
const retry = (body: object = {}, who = admin) => request(app).post(`${BASE}/link/retry`).set(auth(who.token)).send(body);
const forms = (n: number) =>
  submit(
    app,
    wireBatch(),
    Array.from({ length: n }, () => wireApplication()),
  );
const approved = async (n: number): Promise<string[]> => {
  const ids = await forms(n);
  for (const id of ids) await approve(pune, id);
  return ids;
};
const makeDue = () =>
  AppDataSource.query(`UPDATE "ipp_decisions" SET "nextAttemptAt" = now() - interval '1 second' WHERE "nextAttemptAt" IS NOT NULL`);
const sentIds = () => fake.calls.map((call) => call.map((d) => d.application_id));

describe('sending', () => {
  it('sends a decision exactly as the contract says, once', async () => {
    const [id] = await forms(1);
    await reject(pune, id, 'The photo is not clear');
    const [row] = await decisions(id);
    expect(await runIppLinkCycle()).toMatchObject({ ran: true, sent: 1, failed: 0, deferred: 0 });
    expect(fake.calls).toEqual([
      [
        {
          id: row.id,
          application_id: id,
          action: 'REJECT',
          from: 'DIVISION',
          to: 'AUDITOR',
          reason: 'The photo is not clear',
          by: { name: 'Officer Pune', role: 'Divisional Officer' },
          at: expect.stringMatching(/^\d{4}-\d\d-\d\dT.*Z$/),
        } satisfies WireDecision,
      ],
    ]);
    expect((await decisions(id))[0]).toMatchObject({ status: 'SENT', attempts: 1, lastError: null, sentAt: expect.any(Date) });
    expect(await runIppLinkCycle()).toMatchObject({ sent: 0 });
    expect(fake.calls).toHaveLength(1);
    expect(fake.unauthorized).toBe(0);
  });

  it('a decision IPP already has (duplicate) counts as sent', async () => {
    const [id] = await approved(1);
    const [row] = await decisions(id);
    fake.done.add(row.id);
    expect(await runIppLinkCycle()).toMatchObject({ sent: 1 });
    expect((await decisions(id))[0].status).toBe('SENT');
  });

  it('at most 100 per call, oldest first; one per application and call, in the order they were made', async () => {
    const ids = await forms(100);
    await request(app).post(`${BASE}/approve`).set(auth(pune.token)).send({ ids });
    const more = await approved(5);
    await approve(coep, ids[0]);
    expect(await runIppLinkCycle()).toMatchObject({ sent: 106 });
    expect(sentIds().map((c) => c.length)).toEqual([100, 6]);
    expect(new Set(sentIds()[0])).toEqual(new Set(ids));
    expect(sentIds()[1]).toEqual([...more, ids[0]]);
    expect(
      fake.calls
        .flat()
        .filter((d) => d.application_id === ids[0])
        .map((d) => `${d.from}>${d.to}`),
    ).toEqual(['DIVISION>COEP', 'COEP>HEAD_OFFICE']);
  });

  it('a later decision waits while an earlier one of the same application is not sent; the others go on', async () => {
    const [a, b] = await approved(2);
    await approve(coep, a);
    await approve(coep, b);
    fake.refuse.set(a, { code: 'STAGE_MISMATCH', stage: 'AUDITOR' });
    expect(await runIppLinkCycle()).toMatchObject({ sent: 2, failed: 1 });
    expect((await decisions(a)).map((d) => d.status)).toEqual(['FAILED', 'PENDING']);
    expect((await decisions(b)).map((d) => d.status)).toEqual(['SENT', 'SENT']);
    expect(await runIppLinkCycle()).toMatchObject({ sent: 0, failed: 0 });
    /* After Retry the chain goes on in its order. */
    fake.refuse.clear();
    fake.calls = [];
    expect((await retry()).body.data).toEqual({ retried: 1 });
    expect(await runIppLinkCycle()).toMatchObject({ sent: 2 });
    expect(fake.calls.flat().map((d) => d.to)).toEqual(['COEP', 'HEAD_OFFICE']);
  });

  it('a refused decision is FAILED with its code and stage, never with text of the answer', async () => {
    const [id] = await approved(1);
    fake.refuse.set(id, { code: 'STAGE_MISMATCH', stage: 'AUDITOR' });
    await runIppLinkCycle();
    expect((await decisions(id))[0]).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      nextAttemptAt: null,
      lastError: 'IPP refused it: STAGE_MISMATCH (there the form is at AUDITOR)',
    });
  });

  it.each([
    ['503', { status: 503, body: { error: { code: 'LINK_NOT_CONFIGURED', message: 'Asha' } } }, 'IPP answered 503 LINK_NOT_CONFIGURED'],
    ['429', { status: 429, body: {} }, 'IPP answered 429'],
    ['408', { status: 408, body: {} }, 'IPP answered 408'],
    ['500 without JSON', { status: 500, body: '<html>' }, 'IPP answered 500'],
    ['an answer without results', { status: 200, body: { data: {} } }, 'The answer of IPP could not be read'],
    ['no answer in time', 'hang' as const, 'IPP did not answer in time'],
    ['a broken connection', 'drop' as const, 'IPP is not reachable'],
  ])('%s → tried again later', async (_name, answer, error) => {
    const ids = await approved(2);
    fake.answer = () => answer;
    expect(await runIppLinkCycle()).toMatchObject({ sent: 0, failed: 0, deferred: 2 });
    for (const row of await decisions()) {
      expect(row).toMatchObject({ status: 'PENDING', attempts: 1, lastError: error });
      expect(row.wait).toBeGreaterThan(20);
      expect(row.wait).toBeLessThanOrEqual(30);
    }
    /* Not before its time. */
    fake.answer = null;
    expect(await runIppLinkCycle()).toMatchObject({ sent: 0 });
    await makeDue();
    expect(await runIppLinkCycle()).toMatchObject({ sent: 2 });
    expect((await decisions(ids[0]))[0]).toMatchObject({ status: 'SENT', lastError: null, nextAttemptAt: null });
  });

  it('a wrong secret (401) is tried again and shown, without the secret', async () => {
    await approved(1);
    Object.assign(env, { IPP_LINK_SECRET: 'another-secret-another-secret-another-9' });
    await runIppLinkCycle();
    expect(fake.unauthorized).toBe(1);
    const [row] = await decisions();
    expect(row).toMatchObject({ status: 'PENDING', lastError: 'IPP answered 401 LINK_UNAUTHORIZED' });
    expect(JSON.stringify(await link())).not.toMatch(/another-secret|db-test-ipp-link-secret/);
    expect(IPP_SECRET).toContain('db-test');
  });

  it('waits longer every time: 30 s, 1, 2, 5, 10, 30 min, then every hour', async () => {
    const [id] = await approved(1);
    fake.answer = () => ({ status: 503, body: {} });
    const waits: number[] = [];
    for (let i = 0; i < 8; i++) {
      await makeDue();
      await runIppLinkCycle();
      waits.push(Math.round((await decisions(id))[0].wait! / 10) * 10);
    }
    expect(waits).toEqual([30, 60, 120, 300, 600, 1800, 3600, 3600]);
    expect((await decisions(id))[0].attempts).toBe(8);
  });

  it('any other 4xx fails the call', async () => {
    await approved(2);
    fake.answer = () => ({ status: 403, body: { error: { code: 'FORBIDDEN' } } });
    expect(await runIppLinkCycle()).toMatchObject({ failed: 2 });
    for (const row of await decisions()) expect(row).toMatchObject({ status: 'FAILED', lastError: 'IPP answered 403 FORBIDDEN' });
  });

  it('one malformed decision (422) does not fail the others it was sent with', async () => {
    const [a, b, c] = await approved(3);
    fake.answer = (list) =>
      list.some((d) => d.application_id === b) ? { status: 422, body: { error: { code: 'VALIDATION_ERROR' } } } : null;
    expect(await runIppLinkCycle()).toMatchObject({ sent: 2, failed: 1 });
    expect((await decisions(b))[0]).toMatchObject({ status: 'FAILED', lastError: 'IPP answered 422 VALIDATION_ERROR' });
    expect([(await decisions(a))[0].status, (await decisions(c))[0].status]).toEqual(['SENT', 'SENT']);
  });

  it('a decision IPP says nothing about is tried again', async () => {
    const [a, b] = await approved(2);
    fake.answer = (list) => ({
      status: 200,
      body: { data: { results: list.filter((d) => d.application_id === a).map((d) => ({ id: d.id, ok: true, duplicate: false })) } },
    });
    expect(await runIppLinkCycle()).toMatchObject({ sent: 1, deferred: 1 });
    expect((await decisions(b))[0]).toMatchObject({ status: 'PENDING', attempts: 1 });
  });

  it('link off: officers decide, decisions wait; on again, they go', async () => {
    const [id] = await forms(1);
    switchLink(false, fake.url);
    expect((await approve(pune, id)).status).toBe(200);
    expect(await runIppLinkCycle()).toMatchObject({ ran: false, reason: 'off' });
    expect((await decisions(id))[0]).toMatchObject({ status: 'PENDING', attempts: 0 });
    switchLink(true, fake.url);
    expect(await runIppLinkCycle()).toMatchObject({ sent: 1 });
  });

  it('one cycle at a time across instances', async () => {
    await approved(1);
    const other = AppDataSource.createQueryRunner();
    await other.connect();
    await other.query(`SELECT pg_advisory_lock($1)`, [OUTBOX_LOCK_KEY]);
    expect(await runIppLinkCycle()).toMatchObject({ ran: false, reason: 'locked' });
    await other.query(`SELECT pg_advisory_unlock($1)`, [OUTBOX_LOCK_KEY]);
    await other.release();
    expect(await runIppLinkCycle()).toMatchObject({ sent: 1 });
  });
});

describe('poller and kick', () => {
  afterEach(stopIppLinkPoller);
  const until = async (done: () => Promise<boolean> | boolean) => {
    for (let i = 0; i < 100; i++) {
      if (await done()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('did not happen in time');
  };

  it('a new decision goes out at once, and again while one is being sent', async () => {
    const ids = await forms(3);
    startIppLinkPoller();
    for (const id of ids) await approve(pune, id);
    await until(async () => (await decisions()).every((d) => d.status === 'SENT'));
    expect(fake.calls.flat()).toHaveLength(3);
  });

  it('what is waiting goes out when the server starts; without a started poller a kick does nothing', async () => {
    await approved(1);
    kickIppLink();
    await new Promise((r) => setTimeout(r, 200));
    expect(fake.calls).toEqual([]);
    startIppLinkPoller();
    await until(() => fake.calls.length === 1);
  });

  it('does not start while the link is off', async () => {
    await approved(1);
    switchLink(false, fake.url);
    startIppLinkPoller();
    switchLink(true, fake.url);
    kickIppLink();
    await new Promise((r) => setTimeout(r, 200));
    expect(fake.calls).toEqual([]);
  });
});

describe('the link page', () => {
  it('shows the state of the link and what is not sent, oldest first', async () => {
    let data = await link();
    expect(data).toEqual({
      enabled: true,
      configured: true,
      host: new URL(fake.url).host,
      lastSentAt: null,
      lastReceivedAt: null,
      pending: 0,
      failed: 0,
      items: [],
    });
    const [a, b, c] = await approved(3);
    fake.refuse.set(b, { code: 'APPLICATION_UNKNOWN', stage: null });
    await runIppLinkCycle();
    await approve(coep, a);
    const res = await request(app).get(`${BASE}/link`).set(auth(admin.token));
    const parsed = envelope(IppLinkDto).safeParse(res.body);
    expect(parsed.success).toBe(true);
    data = res.body.data;
    expect(data).toMatchObject({ pending: 1, failed: 1, lastSentAt: expect.any(String), lastReceivedAt: expect.any(String) });
    expect((data.items as { application: { id: string }; status: string }[]).map((i) => [i.application.id, i.status])).toEqual([
      [b, 'FAILED'],
      [a, 'PENDING'],
    ]);
    expect(data.items[0]).toMatchObject({
      action: 'APPROVE',
      from: 'DIVISION',
      to: 'COEP',
      attempts: 1,
      lastError: 'IPP refused it: APPLICATION_UNKNOWN',
    });
    /* What was sent is not on the page: PENDING and FAILED only. */
    expect(JSON.stringify(data)).not.toContain(c);
    expect((await decisions(c))[0].status).toBe('SENT');

    switchLink(false, fake.url);
    expect(await link()).toMatchObject({ enabled: false, configured: false, pending: 1, failed: 1 });
    Object.assign(env, { IPP_API_URL: undefined });
    expect((await link()).host).toBeNull();
  });

  it('Retry: the chosen failed ones, or all; only FAILED ones; audited', async () => {
    const [a, b] = await approved(2);
    for (const id of [a, b]) fake.refuse.set(id, { code: 'INVALID_MOVE', stage: 'AUDITOR' });
    await runIppLinkCycle();
    const [row] = await decisions(a);
    expect((await retry({ ids: [row.id, randomUUID()] })).body.data).toEqual({ retried: 1 });
    expect((await decisions(a))[0]).toMatchObject({ status: 'PENDING', attempts: 0, nextAttemptAt: null });
    expect((await decisions(b))[0].status).toBe('FAILED');
    expect((await retry({ ids: [row.id] })).body.data).toEqual({ retried: 0 });
    expect((await retry()).body.data).toEqual({ retried: 1 });
    expect((await retry({ ids: [] })).body.data).toEqual({ retried: 0 });
    for (const body of [{ ids: 'x' }, { ids: ['x'] }, { other: 1 }]) expect((await retry(body)).status).toBe(422);
    expect((await audits('ipp.link.retry')).map((t) => t.details)).toEqual([
      { retried: 1, all: false },
      { retried: 1, all: true },
    ]);
    expect((await retry({}, await actorWith(['settings.view']))).status).toBe(403);
  });

  it('Test: says whether IPP answers, and what to look at when it does not (always 200)', async () => {
    const test = async () => {
      const res = await request(app).post(`${BASE}/link/test`).set(auth(admin.token));
      expect(res.status).toBe(200);
      return res.body.data as { ok: boolean; message: string };
    };
    expect(await test()).toEqual({ ok: true, message: 'IPP answered' });
    expect(fake.pings).toBe(1);
    fake.pingAnswer = { status: 503, body: { error: { code: 'LINK_NOT_CONFIGURED' } } };
    expect(await test()).toEqual({ ok: false, message: 'IPP answered 503 LINK_NOT_CONFIGURED: the link is not switched on in IPP' });
    fake.pingAnswer = 'hang';
    expect(await test()).toEqual({ ok: false, message: 'IPP did not answer in time' });
    Object.assign(env, { IPP_LINK_SECRET: 'another-secret-another-secret-another-9' });
    expect((await test()).message).toMatch(/^IPP answered 401 LINK_UNAUTHORIZED: the secret/);
    switchLink(true, `${fake.url}/wrong`);
    expect((await test()).message).toMatch(/check IPP_API_URL/);
    switchLink(true, 'http://127.0.0.1:9/api/v1');
    expect(await test()).toEqual({ ok: false, message: 'IPP is not reachable' });
    switchLink(false);
    expect(await test()).toEqual({ ok: false, message: 'The link with IPP is not configured on this server' });
  });
});
