import crypto from 'crypto';
import http from 'http';
import type { AddressInfo } from 'net';
import express, { type Request, type Response } from 'express';

/*
 * In-process fake of the LMS tenant API (/tenant/v1, students part) for the lms-sync DB tests. It follows the LMS
 * contract closely enough to test the Amrut side: X-Api-Key check, Idempotency-Key replay and conflict, the strict
 * field list, required fields → `rejected`, upsert by external_student_id, request status, the updated_since list.
 * `mode` simulates outages: 'down' = 503, 'drop' = connection reset, 'quota' = 429 INTAKE_QUOTA_EXCEEDED.
 */
const ALLOWED = new Set([
  'external_student_id',
  'source_record_id',
  'source_updated_at',
  'first_name',
  'last_name',
  'father_name',
  'mother_name',
  'email',
  'date_of_birth',
  'gender',
  'marital_status',
  'current_address',
  'permanent_address',
  'landmark',
  'district',
  'taluka',
  'division',
  'pin_code',
  'aadhaar_number',
  'mobile_number',
  'alternate_mobile_number',
  'alternate_email',
  'religion',
  'caste',
  'disability_status',
  'disability_type',
  'disability_certificate_number',
  'course_centre',
  'technology',
  'education_qualification',
  'qualification_name',
  'qualification_stream',
  'qualification_board',
  'qualification_completed_on',
  'score',
  'score_type',
  'qualification_class',
  'approval_status',
  'approved_at',
  'scheme_name',
  'submitted_at',
  'source_remarks',
  'evidence_ref',
  'declaration_accepted',
  'documents_supplied',
]);
const REQUIRED = [
  'first_name',
  'last_name',
  'father_name',
  'mother_name',
  'email',
  'date_of_birth',
  'gender',
  'permanent_address',
  'landmark',
  'district',
  'taluka',
  'division',
  'pin_code',
  'mobile_number',
];

export interface FakeRecord {
  external_student_id: string;
  status: string;
  reason_codes: string[];
  learner_code: string | null;
  /* The LMS learner id once provisioned (lms-api answers it on the request view since M2-F1). */
  learner_id?: string | null;
  updated_at: string;
  source_updated_at: string;
  payload: Record<string, unknown>;
}

/* What one POST /students call did with a record (lms-api request view `outcome`, M2-F1). */
type FakeOutcome = 'ACCEPTED' | 'INVALID' | 'SKIPPED_UNCHANGED' | 'STALE';

export class FakeLms {
  readonly apiKey: string;
  mode: 'up' | 'down' | 'drop' | 'quota' = 'up';
  /* Records created as PROVISIONED straight away (instead of RECEIVED). */
  autoProvision = false;
  /* external_student_ids the LMS answers with a field error (pin_code format). */
  readonly forceReject = new Set<string>();
  readonly records = new Map<string, FakeRecord>();
  readonly requests = new Map<string, { id: string; outcome: FakeOutcome }[]>();
  /*
   * lms-api since M2-F1 lists EVERY record of a call on GET /students/requests/:id, skipped ones included (with
   * `outcome`, the current status and the learner). false = the LMS before that fix: a record the call skipped
   * (unchanged or older copy) is not listed under the new request (it stays under the call that wrote it).
   */
  listSkipped = true;
  readonly idempotency = new Map<string, { hash: string; answer: unknown }>();
  /* Every POST /students body that reached the handler (also during outages). */
  readonly sendBodies: { headers: http.IncomingHttpHeaders; body: { records: Record<string, unknown>[] } }[] = [];
  /* Calls answered with stored records (not replays, not outages). */
  storedSends = 0;
  private server: http.Server | null = null;
  private clock = Date.parse('2026-11-21T07:00:00.000Z');
  private seq = 0;
  url = '';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private tick(): string {
    this.clock = Math.max(this.clock + 1, Date.now());
    return new Date(this.clock).toISOString();
  }

  private status(r: FakeRecord) {
    return {
      external_student_id: r.external_student_id,
      status: r.status,
      reason_codes: r.reason_codes,
      learner_code: r.learner_code,
      account_status: r.learner_code ? 'PENDING_ACTIVATION' : null,
      allotment: { entity_code: null, centre_code: null, course_code: null, batch_code: null, track_code: null },
      updated_at: r.updated_at,
    };
  }

  /* LMS staff action: the learner is created. */
  provision(externalId: string): void {
    const r = this.records.get(externalId);
    if (!r) throw new Error(`fake LMS: no record ${externalId}`);
    r.status = 'PROVISIONED';
    r.learner_code = r.learner_code ?? `AMK-L-${String(++this.seq).padStart(7, '0')}`;
    r.learner_id = r.learner_id ?? crypto.randomUUID();
    r.updated_at = this.tick();
  }

  setStatus(externalId: string, status: string, reasons: string[] = []): void {
    const r = this.records.get(externalId)!;
    r.status = status;
    r.reason_codes = reasons;
    r.updated_at = this.tick();
  }

  private outage(res: Response): boolean {
    if (this.mode === 'down') {
      res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'down', request_id: 'fake' } });
      return true;
    }
    if (this.mode === 'drop') {
      res.socket?.destroy();
      return true;
    }
    return false;
  }

  private app() {
    const app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use('/tenant/v1', (req, res, next) => {
      if (req.get('x-api-key') !== this.apiKey) {
        res.status(401).json({ error: { code: 'EXTERNAL_KEY_INVALID', message: 'invalid key', request_id: 'fake' } });
        return;
      }
      next();
    });

    app.post('/tenant/v1/students', (req: Request, res: Response) => {
      this.sendBodies.push({ headers: req.headers, body: req.body });
      if (this.outage(res)) return;
      if (this.mode === 'quota') {
        res
          .set('Retry-After', '3600')
          .status(429)
          .json({ error: { code: 'INTAKE_QUOTA_EXCEEDED', message: 'quota', request_id: 'fake' } });
        return;
      }
      const key = req.get('idempotency-key');
      if (!key || key.length > 100) {
        res.status(400).json({ error: { code: 'VALIDATION_FAILED', details: [{ field: 'Idempotency-Key', code: 'required' }] } });
        return;
      }
      const hash = crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
      const seen = this.idempotency.get(key);
      if (seen) {
        if (seen.hash !== hash) res.status(409).json({ error: { code: 'IDEMPOTENCY_CONFLICT' } });
        else res.status(202).json(seen.answer);
        return;
      }
      const body = req.body as { schema_version?: number; records?: Record<string, unknown>[] };
      if (body.schema_version !== 1 || !Array.isArray(body.records) || !body.records.length || body.records.length > 200) {
        res.status(400).json({ error: { code: 'SCHEMA_INVALID' } });
        return;
      }
      for (const rec of body.records)
        for (const k of Object.keys(rec))
          if (!ALLOWED.has(k)) {
            res.status(400).json({ error: { code: 'UNEXPECTED_FIELD', details: [{ field: k, code: 'unexpected' }] } });
            return;
          }
      const requestId = crypto.randomUUID();
      const rejected: { index: number; external_student_id: string | null; errors: { field: string; code: string }[] }[] = [];
      const ids: { id: string; outcome: FakeOutcome }[] = [];
      body.records.forEach((rec, index) => {
        const id = String(rec.external_student_id);
        const entry: { id: string; outcome: FakeOutcome } = { id, outcome: 'ACCEPTED' };
        ids.push(entry);
        const errors = REQUIRED.filter((f) => rec[f] === undefined || rec[f] === '').map((field) => ({ field, code: 'required' }));
        if (this.forceReject.has(id)) errors.push({ field: 'pin_code', code: 'format' });
        const { source_updated_at, ...payload } = rec;
        const existing = this.records.get(id);
        if (errors.length) {
          rejected.push({ index, external_student_id: id, errors });
          entry.outcome = 'INVALID';
          this.records.set(id, {
            ...(existing ?? { learner_code: null }),
            external_student_id: id,
            status: 'INVALID',
            reason_codes: [],
            updated_at: this.tick(),
            source_updated_at: String(source_updated_at),
            payload,
          } as FakeRecord);
          return;
        }
        if (existing && Date.parse(String(source_updated_at)) < Date.parse(existing.source_updated_at)) {
          entry.outcome = 'STALE';
          return;
        }
        // SKIPPED_UNCHANGED (an INVALID record is validated again on a re-send)
        if (existing && existing.status !== 'INVALID' && JSON.stringify(existing.payload) === JSON.stringify(payload)) {
          entry.outcome = 'SKIPPED_UNCHANGED';
          return;
        }
        if (existing) {
          existing.payload = payload;
          existing.source_updated_at = String(source_updated_at);
          existing.updated_at = this.tick();
          if (existing.status !== 'PROVISIONED') existing.status = this.autoProvision ? 'PROVISIONED' : 'RECEIVED';
          if (existing.status === 'PROVISIONED' && !existing.learner_code)
            existing.learner_code = `AMK-L-${String(++this.seq).padStart(7, '0')}`;
          return;
        }
        const r: FakeRecord = {
          external_student_id: id,
          status: 'RECEIVED',
          reason_codes: [],
          learner_code: null,
          updated_at: this.tick(),
          source_updated_at: String(source_updated_at),
          payload,
        };
        this.records.set(id, r);
        if (this.autoProvision) this.provision(id);
      });
      this.requests.set(requestId, ids);
      const answer = { intake_request_id: requestId, accepted: body.records.length - rejected.length, rejected };
      this.idempotency.set(key, { hash, answer });
      this.storedSends++;
      res.status(202).json(answer);
    });

    app.get('/tenant/v1/students/requests/:id', (req, res) => {
      if (this.outage(res)) return;
      const ids = this.requests.get(req.params.id);
      if (!ids) {
        res.status(404).json({ error: { code: 'NOT_FOUND' } });
        return;
      }
      const page = Number(req.query.page ?? 1);
      const size = Number(req.query.page_size ?? 200);
      const items = ids
        .filter((e) => this.listSkipped || e.outcome === 'ACCEPTED' || e.outcome === 'INVALID')
        .map((e) => ({ e, r: this.records.get(e.id) }))
        .filter((x): x is { e: { id: string; outcome: FakeOutcome }; r: FakeRecord } => !!x.r)
        .map(({ e, r }) => ({
          external_student_id: r.external_student_id,
          status: r.status,
          reason_codes: r.reason_codes,
          /* The fields lms-api adds since M2-F1 (absent before it). */
          ...(this.listSkipped ? { outcome: e.outcome, learner_id: r.learner_id ?? null, learner_code: r.learner_code } : {}),
        }));
      res.json({
        intake_request_id: req.params.id,
        received_at: new Date().toISOString(),
        counts: { received: ids.length },
        items: items.slice((page - 1) * size, page * size),
        page,
        page_size: size,
      });
    });

    app.get('/tenant/v1/students/:id', (req, res) => {
      if (this.outage(res)) return;
      const r = this.records.get(req.params.id);
      if (!r) res.status(404).json({ error: { code: 'NOT_FOUND' } });
      else res.json(this.status(r));
    });

    app.get('/tenant/v1/students', (req, res) => {
      if (this.outage(res)) return;
      const since = req.query.updated_since ? Date.parse(String(req.query.updated_since)) : -Infinity;
      const page = Number(req.query.page ?? 1);
      const size = Number(req.query.page_size ?? 200);
      const all = [...this.records.values()]
        .filter((r) => Date.parse(r.updated_at) > since)
        .sort((a, b) => a.updated_at.localeCompare(b.updated_at));
      res.json({ items: all.slice((page - 1) * size, page * size).map((r) => this.status(r)), page, page_size: size, total: all.length });
    });
    return app;
  }

  async start(): Promise<string> {
    this.server = http.createServer(this.app());
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }
}
