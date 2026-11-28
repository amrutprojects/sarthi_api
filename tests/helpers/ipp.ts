import { createHash, createHmac, randomUUID } from 'crypto';
import http from 'http';
import type { AddressInfo } from 'net';
import type { Express } from 'express';
import type { Test } from 'supertest';
import { env } from '../../src/config/env.config';
import { AppDataSource, createUser, login, request, type TestActor } from './test-app';

/*
 * The other side of the IPP link for the tests: signing as IPP does (written out here on its own, so a mistake in the
 * API's signature code cannot hide), messages of IPP, and an in-process fake of IPP's API. Synthetic data only.
 */
export const IPP_SECRET = 'db-test-ipp-link-secret-0123456789-abcdef';
export const MESSAGES = '/integration/v1/ipp/messages';
export const PING = '/integration/v1/ipp/ping';

export const ippSignature = (o: {
  client?: string;
  method: string;
  path: string;
  timestamp: string;
  body: string;
  secret?: string;
}): string =>
  createHmac('sha256', o.secret ?? IPP_SECRET)
    .update([o.client ?? 'ipp', o.method, o.path, o.timestamp, createHash('sha256').update(o.body, 'utf8').digest('hex')].join('\n'))
    .digest('hex');

export const unixNow = (): string => String(Math.floor(Date.now() / 1000));

const originalEnv = {
  IPP_LINK_ENABLED: env.IPP_LINK_ENABLED,
  IPP_API_URL: env.IPP_API_URL,
  IPP_LINK_SECRET: env.IPP_LINK_SECRET,
  IPP_HTTP_TIMEOUT_MS: env.IPP_HTTP_TIMEOUT_MS,
};
/* Nothing listens on port 9 of this machine: a call that should not happen fails at once. */
export const switchLink = (on: boolean, url = 'http://127.0.0.1:9/api/v1') =>
  Object.assign(env, { IPP_LINK_ENABLED: on, IPP_API_URL: url, IPP_LINK_SECRET: IPP_SECRET, IPP_HTTP_TIMEOUT_MS: 1_500 });
export const restoreLink = () => Object.assign(env, originalEnv);

/* A call of IPP to Sarthi, signed. */
export function ippCall(app: Express, method: 'GET' | 'POST', path: string, body?: unknown): Test {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const timestamp = unixNow();
  const headers = { Authorization: `IPP-SARTHI ipp:${ippSignature({ method, path, timestamp, body: raw })}`, 'X-Timestamp': timestamp };
  const call = method === 'GET' ? request(app).get(path) : request(app).post(path);
  call.set(headers);
  return body === undefined ? call : call.set('Content-Type', 'application/json').send(raw);
}

let seq = 1_000;
export const nextSeq = (): number => ++seq;
let batchNo = 0;
let formNo = 0;

export interface WireBatch {
  id: string;
  code: string;
  name: string;
  size: number;
  district: { code: string; name: string; state_code: string };
  centre: { code: string; name: string };
  start_date: string | null;
  end_date: string | null;
  delivery_mode: string;
  technology: { code: string; name: string } | null;
  created_at: string;
  created_by: string | null;
  /* Where the batch is (the Auditor of IPP starts and ends it); an older IPP sends none. */
  status?: 'NOT_STARTED' | 'ONGOING' | 'ENDED';
  started_at?: string | null;
  ended_at?: string | null;
}

export const PUNE = { code: 'PUN', name: 'Pune', state_code: 'MH' };
export const NASHIK = { code: 'NAS', name: 'Nashik', state_code: 'MH' };

export function wireBatch(over: Partial<WireBatch> = {}): WireBatch {
  batchNo++;
  return {
    id: randomUUID(),
    code: `IPP-B-${String(batchNo).padStart(4, '0')}`,
    name: `Batch ${batchNo}`,
    size: 30,
    district: PUNE,
    centre: { code: 'CTR-01', name: 'Synthetic Centre' },
    start_date: '2026-12-01',
    end_date: '2027-02-28',
    delivery_mode: 'OFFLINE',
    technology: { code: 'T03', name: 'Web Design & Development' },
    created_at: '2026-11-25T05:00:00.000Z',
    created_by: 'Synthetic Auditor',
    ...over,
  };
}

export type WireApplication = ReturnType<typeof wireApplication>;
export function wireApplication(over: Record<string, unknown> = {}) {
  formNo++;
  return {
    action: 'SUBMIT',
    id: randomUUID(),
    registration_id: `IPP-${String(formNo).padStart(6, '0')}`,
    registration_number: null,
    name: `Asha Example ${formNo}`,
    email: `asha${formNo}@example.invalid`,
    mobile_number: `98765${String(formNo).padStart(5, '0')}`,
    aadhaar_masked: 'XXXX-XXXX-1234',
    district: 'Pune',
    category: 'Open',
    centre: 'Synthetic Centre',
    technology: 'Web Design & Development',
    submitted_at: '2026-11-20T10:00:00.000Z',
    auditor_approved_at: '2026-11-24T10:00:00.000Z',
    auditor_approved_by: 'Synthetic Auditor',
    fields: [
      { key: 'full_name', step: 1, label_en: 'Full name', label_mr: 'पूर्ण नाव', type: 'text', text: `Asha Example ${formNo}` },
      { key: 'centre', step: 2, label_en: 'Centre', label_mr: 'केंद्र', type: 'select', text: 'Synthetic Centre' },
    ],
    documents: [
      {
        code: 'AADHAAR_CARD',
        name: 'Aadhaar card',
        name_mr: 'आधार कार्ड',
        required: true,
        kind: 'DOCUMENT',
        file: { name: 'आधार card.pdf', mime: 'application/pdf', size: 12, uploaded_at: '2026-11-20T09:00:00.000Z' },
        verified: true,
        verified_at: '2026-11-24T09:00:00.000Z',
        verified_by: 'Synthetic Auditor',
      },
      {
        code: 'INTRO_VIDEO',
        name: 'Introduction',
        name_mr: null,
        required: false,
        kind: 'VIDEO',
        file: { name: 'intro.mp4', mime: 'video/mp4', size: 9, uploaded_at: '2026-11-20T09:00:00.000Z' },
        verified: false,
        verified_at: null,
        verified_by: null,
      },
      {
        code: 'PAN',
        name: 'PAN',
        name_mr: null,
        required: false,
        kind: 'DOCUMENT',
        file: null,
        verified: false,
        verified_at: null,
        verified_by: null,
      },
    ],
    edits: [] as unknown[],
    ...over,
  };
}

export const wireMessage = (batch: WireBatch, applications: unknown[], over: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  seq: nextSeq(),
  sent_at: new Date().toISOString(),
  batch,
  applications,
  ...over,
});

/* Sends applications in one batch through the real endpoint; returns their ids. The link must be on. */
export async function submit(app: Express, batch: WireBatch, applications: WireApplication[]): Promise<string[]> {
  const res = await ippCall(app, 'POST', MESSAGES, wireMessage(batch, applications));
  if (res.status !== 200) throw new Error(`message refused (${res.status}): ${JSON.stringify(res.body)}`);
  return applications.map((a) => a.id);
}

/* States and districts are emptied by resetData: Maharashtra with the districts the tests need. */
export async function seedDistricts(): Promise<Record<'PUN' | 'NAS' | 'THA', string>> {
  const [state] = (await AppDataSource.query(`INSERT INTO "states" ("name", "code") VALUES ('Maharashtra', 'MH') RETURNING "id"`)) as {
    id: string;
  }[];
  const out: Record<string, string> = {};
  for (const [code, name] of [
    ['PUN', 'Pune'],
    ['NAS', 'Nashik'],
    ['THA', 'Thane'],
  ]) {
    const [d] = (await AppDataSource.query(`INSERT INTO "districts" ("stateId", "name", "code") VALUES ($1, $2, $3) RETURNING "id"`, [
      state.id,
      name,
      code,
    ])) as { id: string }[];
    out[code] = d.id;
  }
  return out as Record<'PUN' | 'NAS' | 'THA', string>;
}

export async function signedIn(roleCodes: string[], name?: string): Promise<TestActor> {
  const user = await createUser({ roleCodes, name });
  return { user, token: await login(user.email) };
}

/* A Divisional Officer with these districts. */
export async function divisionalOfficer(districtIds: string[], name?: string): Promise<TestActor> {
  const actor = await signedIn(['DIVISIONAL_OFFICER'], name);
  for (const districtId of districtIds)
    await AppDataSource.query(`INSERT INTO "user_districts" ("userId", "districtId") VALUES ($1, $2)`, [actor.user.id, districtId]);
  return actor;
}

/* Empties the module's own tables (and the switch), keeping users, roles and districts. */
export async function resetIpp(): Promise<void> {
  await AppDataSource.query(
    `TRUNCATE "ipp_decisions", "ipp_approval_events", "ipp_messages", "ipp_applications", "ipp_batches", "audit_logs", "idempotency_keys"`,
  );
  await AppDataSource.query(`DELETE FROM "panel_settings" WHERE "key" = 'ipp.head_office_approval'`);
}

export const stageOf = async (id: string): Promise<string> =>
  ((await AppDataSource.query(`SELECT "stage" FROM "ipp_applications" WHERE "id" = $1`, [id])) as { stage: string }[])[0]?.stage;

export interface DecisionRow {
  id: string;
  applicationId: string;
  action: string;
  fromStage: string;
  toStage: string;
  reason: string | null;
  byName: string;
  byRole: string;
  status: string;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: Date | null;
  sentAt: Date | null;
  wait: number | null;
}
export const decisions = (applicationId?: string): Promise<DecisionRow[]> =>
  AppDataSource.query(
    `SELECT *, EXTRACT(EPOCH FROM ("nextAttemptAt" - now()))::float AS "wait" FROM "ipp_decisions"
      WHERE $1::uuid IS NULL OR "applicationId" = $1 ORDER BY "seq"`,
    [applicationId ?? null],
  );

export const events = (
  applicationId: string,
): Promise<{ event: string; fromStage: string | null; toStage: string; reason: string | null; byName: string; byRole: string }[]> =>
  AppDataSource.query(`SELECT * FROM "ipp_approval_events" WHERE "applicationId" = $1 ORDER BY "seq"`, [applicationId]);

export const audits = (
  action: string,
): Promise<{ actorUserId: string | null; resource: string; resourceId: string | null; details: Record<string, unknown> }[]> =>
  AppDataSource.query(`SELECT * FROM "audit_logs" WHERE "action" = $1 ORDER BY "createdAt"`, [action]);

export interface WireDecision {
  id: string;
  application_id: string;
  action: string;
  from: string;
  to: string;
  reason: string | null;
  by: { name: string; role: string };
  at: string;
}

type Answer = { status: number; body: unknown } | 'hang' | 'drop';

/* IPP's API, in process. It checks the signature like IPP and does a decision once per id. */
export class FakeIpp {
  private server?: http.Server;
  url = '';
  /* Every accepted call of POST /link/decisions, as sent. */
  calls: WireDecision[][] = [];
  readonly done = new Set<string>();
  unauthorized = 0;
  pings = 0;
  documentCalls: string[] = [];
  /* Answer of POST /link/decisions instead of the normal one. */
  answer: ((list: WireDecision[]) => Answer | null) | null = null;
  /* Refusals per application id (ok: false). */
  readonly refuse = new Map<string, { code: string; stage: string | null }>();
  pingAnswer: Answer | null = null;
  /* Answer of the document route; default 404. */
  document: ((req: http.IncomingMessage, res: http.ServerResponse) => void) | null = null;

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => this.handle(req, res, Buffer.concat(chunks).toString('utf8')));
    });
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/api/v1`;
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }

  reset(): void {
    this.calls = [];
    this.done.clear();
    this.unauthorized = 0;
    this.pings = 0;
    this.documentCalls = [];
    this.answer = null;
    this.refuse.clear();
    this.pingAnswer = null;
    this.document = null;
  }

  private json(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private give(req: http.IncomingMessage, res: http.ServerResponse, answer: Answer): void {
    if (answer === 'hang') return;
    if (answer === 'drop') {
      req.socket.destroy();
      return;
    }
    this.json(res, answer.status, answer.body);
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse, body: string): void {
    const timestamp = String(req.headers['x-timestamp'] ?? '');
    const expected = ippSignature({ client: 'sarthi', method: String(req.method), path: String(req.url), timestamp, body });
    if (req.headers.authorization !== `IPP-SARTHI sarthi:${expected}` || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
      this.unauthorized++;
      this.json(res, 401, { success: false, status: 401, message: 'bad signature', data: null, error: { code: 'LINK_UNAUTHORIZED' } });
      return;
    }
    if (req.method === 'GET' && req.url === '/api/v1/link/ping') {
      this.pings++;
      if (this.pingAnswer) return this.give(req, res, this.pingAnswer);
      return this.json(res, 200, { success: true, status: 200, message: 'ok', data: { ok: true, time: new Date().toISOString() } });
    }
    if (req.method === 'GET' && req.url?.startsWith('/api/v1/link/applications/')) {
      this.documentCalls.push(req.url);
      if (this.document) return this.document(req, res);
      return this.json(res, 404, { success: false, status: 404, message: 'none', data: null, error: { code: 'NOT_FOUND' } });
    }
    if (req.method === 'POST' && req.url === '/api/v1/link/decisions') {
      const list = (JSON.parse(body) as { decisions: WireDecision[] }).decisions;
      const special = this.answer?.(list) ?? null;
      if (special) return this.give(req, res, special);
      this.calls.push(list);
      const results = list.map((d) => {
        const no = this.refuse.get(d.application_id);
        if (no) return { id: d.id, ok: false, code: no.code, message: `text of IPP for ${d.by.name}`, stage: no.stage };
        const duplicate = this.done.has(d.id);
        this.done.add(d.id);
        return { id: d.id, ok: true, duplicate };
      });
      return this.json(res, 200, { success: true, status: 200, message: 'ok', data: { results } });
    }
    this.json(res, 404, { success: false, status: 404, message: 'no route', data: null, error: { code: 'ROUTE_NOT_FOUND' } });
  }
}
