import 'reflect-metadata';
import crypto from 'crypto';
import { AppDataSource } from '../../../src/config/database.config';
import { env } from '../../../src/config/env.config';
import { createLmsClient } from '../../../src/modules/lms-sync/lms-client';
import { createLmsSyncWorker, type LmsSyncWorker, type SyncLogger } from '../../../src/modules/lms-sync/lms-sync.worker';
import { lmsSyncService } from '../../../src/modules/lms-sync/lms-sync.service';
import { assertTestDatabase } from '../../helpers/guard';
import { FakeLms } from '../../helpers/fake-lms';

/*
 * M1 Amrut → LMS student sync against the test database, with the LMS faked by an in-process HTTP server
 * (tests/helpers/fake-lms.ts). The worker only reads `students`; students are inserted here as import finalisation
 * and registration approval write them. Gate items: same student twice → one LMS record; an edit → resend; LMS
 * down → queued and recovered; keys never logged.
 */
const KEY = `test-tenant-key-${crypto.randomBytes(12).toString('hex')}`;
/* No tenant code is preset in the app; tests/helpers/set-env.ts gives the DB tests an explicit one. */
const TENANT = env.LMS_TENANT_CODE ?? '';
if (!TENANT) throw new Error('LMS_TENANT_CODE must be set for this test (tests/helpers/set-env.ts)');
const fake = new FakeLms(KEY);
const logs: unknown[] = [];
const log: SyncLogger = {
  info: (o, m) => void logs.push(['info', o, m]),
  warn: (o, m) => void logs.push(['warn', o, m]),
  error: (o, m) => void logs.push(['error', o, m]),
};
let worker: LmsSyncWorker;
let seq = 0;
let importBatchId: string;

const makeWorker = (apiKey = KEY) =>
  createLmsSyncWorker({
    ds: AppDataSource,
    client: createLmsClient({ baseUrl: fake.url, apiKey, timeoutMs: 3_000, maxRetries: 1, baseDelayMs: 1, maxDelayMs: 5 }),
    tenantCode: TENANT,
    batchSize: 50,
    followMinAgeSeconds: 0,
    log,
  });

interface StudentOpts {
  status?: 'RECEIVED' | 'REGISTRATION_PENDING';
  active?: boolean;
  deleted?: boolean;
  landmark?: string | null;
}
/* A synthetic student, every column filled, restricted ones with recognisable markers. */
async function insertStudent(o: StudentOpts = {}): Promise<string> {
  seq++;
  const [row] = (await AppDataSource.query(
    `INSERT INTO "students" ("code", "sourceChecksum", "firstName", "lastName", "fatherName", "motherName", "email", "dateOfBirth",
       "currentAddress", "aadhaarLast4", "mobile", "religion", "caste", "centreCode", "trackCode", "trackSourceValue",
       "educationQualification", "externalStatus", "approvedAt", "source", "status", "isActive", "isDelete", "gender", "permanentAddress",
       "landmark", "districtName", "talukaName", "division", "pinCode", "disabilityStatus", "disabilityType",
       "disabilityCertificateNumber", "sourceRemarks", "documents", "importBatchId")
     VALUES ($1, $2, 'Asha', $3, 'Synthetic Father', 'Synthetic Mother', $4, '2004-05-17', 'MARKER-CURRENT-ADDRESS', '9012', $5,
       'MARKER-RELIGION', 'MARKER-CASTE', 'NAG', 'T03', 'Web Design & Development', 'Graduate', 'APPROVED', now(), 'IMPORT', $6, $7, $8,
       'Female', 'Synthetic permanent address', $9, 'Nagpur', 'Nagpur Rural', 'Nagpur', '440001', true, 'MARKER-DISABILITY', 'MARKER-UDID',
       'MARKER-REMARK', '{"PHOTO":{"supplied":true,"barcode":null},"CASTE_CERT":{"supplied":true,"barcode":null}}'::jsonb, $10)
     RETURNING "id"`,
    [
      `STU-LMS-${String(seq).padStart(4, '0')}`,
      String(seq).padStart(64, 'a'),
      `Example${seq}`,
      `student${seq}@example.test`,
      `98765${String(seq).padStart(5, '0')}`,
      o.status ?? 'RECEIVED',
      o.active ?? true,
      o.deleted ?? false,
      o.landmark === undefined ? 'Synthetic landmark' : o.landmark,
      importBatchId,
    ],
  )) as { id: string }[];
  return row.id;
}

interface LinkRow {
  syncStatus: string;
  lmsRequestId: string | null;
  lmsLearnerCode: string | null;
  lmsStatus: string | null;
  payloadChecksum: string | null;
  attempts: number;
  lastErrorCode: string | null;
  lastErrorDetails: { field?: string; code: string }[];
  nextAttemptAt: Date | null;
  secondsUntilNext: number | null;
}
const link = async (studentId: string): Promise<LinkRow | undefined> =>
  (
    (await AppDataSource.query(
      `SELECT *, EXTRACT(EPOCH FROM ("nextAttemptAt" - now()))::float AS "secondsUntilNext"
         FROM "student_lms_link" WHERE "studentId" = $1 AND "lmsTenantCode" = $2`,
      [studentId, TENANT],
    )) as LinkRow[]
  )[0];
/* Lets a deferred (backoff) record be due now. */
const makeDue = (studentId: string) =>
  AppDataSource.query(`UPDATE "student_lms_link" SET "nextAttemptAt" = now() - interval '1 second' WHERE "studentId" = $1`, [studentId]);

beforeAll(async () => {
  assertTestDatabase(env.DB_DATABASE);
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  await AppDataSource.query(`TRUNCATE "student_lms_link", "lms_sync_state", "students", "import_batches" RESTART IDENTITY CASCADE`);
  /* Imported students carry their import batch (CHK_students_import_approved). */
  const [user] = (await AppDataSource.query(
    `INSERT INTO "users" ("name", "email", "passwordHash") VALUES ('Sync Test Importer', $1, 'x') RETURNING "id"`,
    [`importer.${Date.now()}@test.local`],
  )) as { id: string }[];
  const [batch] = (await AppDataSource.query(
    `INSERT INTO "import_batches" ("code", "status", "fileName", "fileChecksum", "fileSize", "createdById")
     VALUES ('IMP-LMS-SYNC', 'FINALISED', 'students.xlsx', $1, 1, $2) RETURNING "id"`,
    ['e'.repeat(64), user.id],
  )) as { id: string }[];
  importBatchId = batch.id;
  await fake.start();
  worker = makeWorker();
});

afterAll(async () => {
  await fake.stop();
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
});

describe('lms sync worker', () => {
  let a: string;

  it('sends each approved, active student once and never the restricted fields', async () => {
    a = await insertStudent();
    const pending = await insertStudent({ status: 'REGISTRATION_PENDING' });
    const inactive = await insertStudent({ active: false });
    const deleted = await insertStudent({ deleted: true });

    const stats = await worker.runCycle();
    expect(stats).toMatchObject({ ran: true, sent: 1, rejected: 0, lmsUnavailable: false });
    expect([...fake.records.keys()]).toEqual([a]);
    for (const id of [pending, inactive, deleted]) expect(await link(id)).toBeUndefined();

    const l = await link(a);
    expect(l).toMatchObject({ syncStatus: 'SENT', attempts: 1, lastErrorCode: null });
    expect(l!.lmsRequestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(l!.payloadChecksum).toMatch(/^[0-9a-f]{64}$/);

    const sent = fake.sendBodies[0];
    expect(sent.headers['idempotency-key']).toMatch(/^amrut-sync-[0-9a-f]{48}$/);
    const rec = sent.body.records[0];
    expect(rec.external_student_id).toBe(a);
    for (const f of [
      'aadhaar_number',
      'religion',
      'caste',
      'disability_status',
      'disability_type',
      'disability_certificate_number',
      'current_address',
      'source_remarks',
    ])
      expect(rec).not.toHaveProperty(f);
    expect(JSON.stringify(sent.body)).not.toMatch(/MARKER|9012/);
    expect(rec.documents_supplied).toEqual({ doc_photo: true });
  });

  it('same student again → no second send, one LMS record', async () => {
    const before = fake.sendBodies.length;
    const stats = await worker.runCycle();
    expect(stats.sent).toBe(0);
    expect(fake.sendBodies.length).toBe(before);
    expect(fake.records.size).toBe(1);
  });

  it('follows the request and reconciles: PROVISIONED → SYNCED with the learner code', async () => {
    fake.provision(a);
    await worker.runCycle();
    const l = await link(a);
    expect(l).toMatchObject({ syncStatus: 'SYNCED', lmsStatus: 'PROVISIONED' });
    expect(l!.lmsLearnerCode).toMatch(/^AMK-L-\d{7}$/);
  });

  it('"Push to LMS" of an unchanged student re-sends it: still one LMS record, LMS copy unchanged', async () => {
    const before = JSON.stringify(fake.records.get(a)!.payload);
    const lmsUpdatedAt = fake.records.get(a)!.updated_at;
    const res = await lmsSyncService.push([a, crypto.randomUUID()]);
    expect(res.queued).toEqual([a]);
    expect(res.skipped).toEqual([{ studentId: expect.any(String), reason: 'NOT_FOUND' }]);
    expect((await link(a))!.syncStatus).toBe('PENDING');
    await worker.runCycle();
    expect(fake.records.size).toBe(1);
    /* Same data with a newer source_updated_at: the LMS skips it as unchanged. */
    expect(JSON.stringify(fake.records.get(a)!.payload)).toBe(before);
    expect(fake.records.get(a)!.updated_at).toBe(lmsUpdatedAt);
    expect((await link(a))!.syncStatus).toBe('SYNCED');
  });

  it('a touch without a data change is not sent; an edit is sent again and the LMS copy updated', async () => {
    const before = fake.sendBodies.length;
    await AppDataSource.query(`UPDATE "students" SET "religion" = 'MARKER-RELIGION-2' WHERE "id" = $1`, [a]);
    let stats = await worker.runCycle();
    expect(stats).toMatchObject({ sent: 0, unchanged: 1 });
    expect(fake.sendBodies.length).toBe(before);

    await AppDataSource.query(`UPDATE "students" SET "mobile" = '9876599999' WHERE "id" = $1`, [a]);
    stats = await worker.runCycle();
    expect(stats.sent).toBe(1);
    expect(fake.records.get(a)!.payload.mobile_number).toBe('9876599999');
    expect(fake.records.size).toBe(1);
    /* Still provisioned on the LMS side: the follow step brings the flag back to SYNCED in the same cycle. */
    expect(await link(a)).toMatchObject({ syncStatus: 'SYNCED', attempts: 1 });
  });

  it('LMS down → the student stays queued (PENDING, backoff) and recovers when the LMS is back', async () => {
    const e = await insertStudent();
    fake.mode = 'down';
    let stats = await worker.runCycle();
    expect(stats).toMatchObject({ lmsUnavailable: true, deferred: 1, sent: 0 });
    let l = await link(e);
    expect(l).toMatchObject({ syncStatus: 'PENDING', attempts: 1, lastErrorCode: 'SERVICE_UNAVAILABLE' });
    expect(l!.secondsUntilNext).toBeGreaterThan(0);

    /* Not due yet: nothing reaches the LMS. */
    const calls = fake.sendBodies.length;
    await worker.runCycle();
    expect(fake.sendBodies.length).toBe(calls);

    /* Connection dropped this time. */
    fake.mode = 'drop';
    await makeDue(e);
    stats = await worker.runCycle();
    expect(stats.lmsUnavailable).toBe(true);
    expect(await link(e)).toMatchObject({ syncStatus: 'PENDING', attempts: 2, lastErrorCode: 'LMS_UNREACHABLE' });

    fake.mode = 'up';
    await makeDue(e);
    stats = await worker.runCycle();
    expect(stats.sent).toBe(1);
    l = await link(e);
    expect(l).toMatchObject({ syncStatus: 'SENT', lastErrorCode: null });
    expect(fake.records.has(e)).toBe(true);
  });

  it('hourly quota (429, Retry-After 3600) defers the record by the Retry-After', async () => {
    const q = await insertStudent();
    fake.mode = 'quota';
    const stats = await worker.runCycle();
    fake.mode = 'up';
    expect(stats).toMatchObject({ lmsUnavailable: true, errorCode: 'INTAKE_QUOTA_EXCEEDED' });
    const l = await link(q);
    expect(l).toMatchObject({ syncStatus: 'PENDING', lastErrorCode: 'INTAKE_QUOTA_EXCEEDED' });
    expect(l!.secondsUntilNext).toBeGreaterThan(3500);
    await makeDue(q);
    expect((await worker.runCycle()).sent).toBe(1);
  });

  it('missing required data → FAILED without a send; filling it in sends the student', async () => {
    const m = await insertStudent({ landmark: null });
    const calls = fake.sendBodies.length;
    const stats = await worker.runCycle();
    expect(stats.missingFields).toBe(1);
    expect(fake.sendBodies.length).toBe(calls);
    expect(await link(m)).toMatchObject({
      syncStatus: 'FAILED',
      lastErrorCode: 'MISSING_REQUIRED_FIELDS',
      lastErrorDetails: [{ field: 'landmark', code: 'required' }],
    });

    await AppDataSource.query(`UPDATE "students" SET "landmark" = 'Filled landmark' WHERE "id" = $1`, [m]);
    expect((await worker.runCycle()).sent).toBe(1);
    expect((await link(m))!.syncStatus).toBe('SENT');
  });

  it('a record the LMS rejects is FAILED with its field codes; Retry queues it again', async () => {
    const r = await insertStudent();
    fake.forceReject.add(r);
    const stats = await worker.runCycle();
    expect(stats.rejected).toBe(1);
    expect(await link(r)).toMatchObject({
      syncStatus: 'FAILED',
      lastErrorCode: 'LMS_REJECTED_FIELDS',
      lastErrorDetails: [{ field: 'pin_code', code: 'format' }],
    });

    fake.forceReject.delete(r);
    const res = await lmsSyncService.retry([r]);
    expect(res.queued).toEqual([r]);
    await worker.runCycle();
    expect((await link(r))!.syncStatus).toBe('SENT');
  });

  it('LMS duplicate suspicion → REVIEW; LMS rejection → FAILED (reconciliation)', async () => {
    const d = await insertStudent();
    const x = await insertStudent();
    await worker.runCycle();
    fake.setStatus(d, 'DUPLICATE_SUSPECT', ['SAME_MOBILE']);
    fake.setStatus(x, 'REJECTED', ['STAFF_DECISION']);
    await worker.runCycle();
    expect(await link(d)).toMatchObject({ syncStatus: 'REVIEW', lmsStatus: 'DUPLICATE_SUSPECT', lastErrorCode: 'LMS_DUPLICATE_SUSPECT' });
    expect(await link(x)).toMatchObject({
      syncStatus: 'FAILED',
      lastErrorCode: 'LMS_REJECTED',
      lastErrorDetails: [{ code: 'STAFF_DECISION' }],
    });
  });

  it('a queued student that is no longer eligible is not sent (NOT_ELIGIBLE)', async () => {
    const n = await insertStudent();
    await lmsSyncService.push([n]);
    await AppDataSource.query(`UPDATE "students" SET "isActive" = false WHERE "id" = $1`, [n]);
    const calls = fake.sendBodies.length;
    const stats = await worker.runCycle();
    expect(stats.notEligible).toBe(1);
    expect(fake.sendBodies.length).toBe(calls);
    expect(await link(n)).toMatchObject({ syncStatus: 'FAILED', lastErrorCode: 'NOT_ELIGIBLE' });
  });

  it('one cycle at a time (advisory lock held elsewhere → the cycle skips)', async () => {
    const other = AppDataSource.createQueryRunner();
    await other.connect();
    try {
      await other.query(`SELECT pg_advisory_lock(727274001)`);
      expect(await worker.runCycle()).toMatchObject({ ran: false, reason: 'locked' });
    } finally {
      await other.query(`SELECT pg_advisory_unlock(727274001)`);
      await other.release();
    }
    expect((await worker.runCycle()).ran).toBe(true);
  });

  it('a wrong key keeps the students queued, and no key ever reaches a log line or a stored row', async () => {
    const w = await insertStudent();
    const wrongKey = `wrong-key-${crypto.randomBytes(12).toString('hex')}`;
    const stats = await makeWorker(wrongKey).runCycle();
    expect(stats).toMatchObject({ errorCode: 'EXTERNAL_KEY_INVALID', deferred: 1 });
    expect(await link(w)).toMatchObject({ syncStatus: 'PENDING', lastErrorCode: 'EXTERNAL_KEY_INVALID' });

    await makeDue(w);
    await worker.runCycle();
    expect((await link(w))!.syncStatus).toBe('SENT');

    expect(logs.length).toBeGreaterThan(0);
    const logText = JSON.stringify(logs);
    const rows = JSON.stringify(await AppDataSource.query(`SELECT * FROM "student_lms_link"`));
    const state = JSON.stringify(await AppDataSource.query(`SELECT * FROM "lms_sync_state"`));
    for (const secret of [KEY, wrongKey]) {
      expect(logText).not.toContain(secret);
      expect(rows).not.toContain(secret);
      expect(state).not.toContain(secret);
    }
    /* And nothing personal in the log lines either: ids, counts and codes only. */
    expect(logText).not.toMatch(/MARKER|example\.test|98765/);
  });
});
