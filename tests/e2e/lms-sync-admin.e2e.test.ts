import type { Express } from 'express';
import {
  API,
  AppDataSource,
  actorWith,
  auth,
  createUser,
  request,
  setupTestApp,
  teardownTestApp,
  type TestActor,
} from '../helpers/test-app';

/*
 * Admin endpoints of the M1 Amrut → LMS student sync (/api/v1/lms-sync, docs/lms-sync/admin-api.md). The sync is
 * switched off in tests (LMS_SYNC_ENABLED unset): Push and Retry only queue, Run answers 409. The worker itself is
 * covered by tests/integration/lms-sync/lms-sync-worker.test.ts.
 */
let app: Express;
let viewer: TestActor;
let operator: TestActor;
let outsider: TestActor;
const ids: Record<string, string> = {};
const BASE = `${API}/lms-sync`;
let importBatchId: string;

async function student(code: string, status = 'RECEIVED', active = true): Promise<string> {
  const [row] = (await AppDataSource.query(
    `INSERT INTO "students" ("code", "sourceChecksum", "firstName", "lastName", "fatherName", "motherName", "currentAddress", "religion",
       "caste", "centreCode", "trackCode", "trackSourceValue", "educationQualification", "externalStatus", "approvedAt", "source", "status",
       "isActive", "email", "mobile", "dateOfBirth", "gender", "permanentAddress", "landmark", "districtName", "talukaName", "division", "pinCode",
       "importBatchId")
     VALUES ($1, $2, 'Asha', $3, 'Father', 'Mother', 'Address', 'R', 'C', 'NAG', 'T03', 'Track', 'Graduate', 'APPROVED', now(), 'IMPORT', $4, $5,
       'a@example.test', '9876500001', '2004-05-17', 'Female', 'Permanent', NULL, 'Nagpur', 'Nagpur Rural', 'Nagpur', '440001', $6)
     RETURNING "id"`,
    [code, code.padEnd(64, 'x'), code, status, active, importBatchId],
  )) as { id: string }[];
  return row.id;
}

beforeAll(async () => {
  app = await setupTestApp();
  viewer = await actorWith(['imports.view']);
  operator = await actorWith(['imports.view', 'imports.update']);
  outsider = await actorWith(['dashboard.view']);
  const importer = await createUser();
  const [batch] = (await AppDataSource.query(
    `INSERT INTO "import_batches" ("code", "status", "fileName", "fileChecksum", "fileSize", "createdById")
     VALUES ('IMP-SYNC', 'FINALISED', 'students.xlsx', $1, 1, $2) RETURNING "id"`,
    ['d'.repeat(64), importer.id],
  )) as { id: string }[];
  importBatchId = batch.id;
  ids.A = await student('STU-SYNC-A');
  ids.B = await student('STU-SYNC-B');
  ids.P = await student('STU-SYNC-P', 'REGISTRATION_PENDING');
  /* B already failed once on the LMS side. */
  await AppDataSource.query(
    `INSERT INTO "student_lms_link" ("studentId", "lmsTenantCode", "syncStatus", "attempts", "lastErrorCode", "lastErrorDetails")
     VALUES ($1, 'AMRUT', 'FAILED', 2, 'LMS_REJECTED_FIELDS', '[{"field":"pin_code","code":"format"}]')`,
    [ids.B],
  );
});
afterAll(teardownTestApp);

describe('LMS sync admin API', () => {
  it('needs a session and the register permissions', async () => {
    expect((await request(app).get(`${BASE}/students`)).status).toBe(401);
    expect((await request(app).get(`${BASE}/students`).set(auth(outsider.token))).status).toBe(403);
    expect(
      (
        await request(app)
          .post(`${BASE}/students/push`)
          .set(auth(viewer.token))
          .send({ studentIds: [ids.A] })
      ).status,
    ).toBe(403);
    expect((await request(app).post(`${BASE}/students/retry`).set(auth(viewer.token)).send({})).status).toBe(403);
  });

  it('summary counts eligible students per flag', async () => {
    const res = await request(app).get(`${BASE}/summary`).set(auth(viewer.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ tenantCode: 'AMRUT', syncEnabled: false, eligible: 2 });
    expect(res.body.data.byStatus).toMatchObject({ NOT_SYNCED: 1, FAILED: 1, PENDING: 0, SENT: 0, SYNCED: 0, REVIEW: 0 });
  });

  it('lists and filters students by sync flag', async () => {
    let res = await request(app).get(`${BASE}/students`).set(auth(viewer.token));
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ total: 2, page: 1 });
    res = await request(app).get(`${BASE}/students?syncStatus=NOT_SYNCED`).set(auth(viewer.token));
    expect(res.body.data.map((s: { code: string }) => s.code)).toEqual(['STU-SYNC-A']);
    expect(res.body.data[0]).toMatchObject({ syncStatus: 'NOT_SYNCED', eligible: true, attempts: 0 });
    expect(res.body.data[0]).not.toHaveProperty('email');
    res = await request(app).get(`${BASE}/students?syncStatus=failed,synced`).set(auth(viewer.token));
    expect(res.body.data).toEqual([
      expect.objectContaining({ code: 'STU-SYNC-B', syncStatus: 'FAILED', lastErrorCode: 'LMS_REJECTED_FIELDS' }),
    ]);
    res = await request(app).get(`${BASE}/students?scope=all&search=SYNC-P`).set(auth(viewer.token));
    expect(res.body.data).toEqual([expect.objectContaining({ code: 'STU-SYNC-P', eligible: false, syncStatus: 'NOT_SYNCED' })]);
    expect((await request(app).get(`${BASE}/students?syncStatus=BOGUS`).set(auth(viewer.token))).status).toBe(422);
  });

  it('shows one student’s sync detail with the fields that would be sent (names only)', async () => {
    const res = await request(app).get(`${BASE}/students/${ids.B}`).set(auth(viewer.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      code: 'STU-SYNC-B',
      syncStatus: 'FAILED',
      attempts: 2,
      lastErrorDetails: [{ field: 'pin_code', code: 'format' }],
      payload: { missingRequiredFields: ['landmark'], changedSinceLastSend: true },
    });
    expect(res.body.data.payload.fields).toContain('external_student_id');
    expect(res.body.data.payload.fields).not.toContain('caste');
    expect(JSON.stringify(res.body.data)).not.toContain('9876500001');
    expect((await request(app).get(`${BASE}/students/00000000-0000-4000-8000-000000000000`).set(auth(viewer.token))).status).toBe(404);
  });

  it('"Push to LMS" queues eligible students and reports the others', async () => {
    const res = await request(app)
      .post(`${BASE}/students/push`)
      .set(auth(operator.token))
      .send({ studentIds: [ids.A, ids.P] });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ syncEnabled: false, queued: [ids.A], skipped: [{ studentId: ids.P, reason: 'NOT_ELIGIBLE' }] });
    const detail = await request(app).get(`${BASE}/students/${ids.A}`).set(auth(viewer.token));
    expect(detail.body.data.syncStatus).toBe('PENDING');
    expect((await request(app).post(`${BASE}/students/push`).set(auth(operator.token)).send({ studentIds: [] })).status).toBe(422);
  });

  it('"Retry" puts failed students back in the queue', async () => {
    const res = await request(app).post(`${BASE}/students/retry`).set(auth(operator.token)).send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ syncEnabled: false, queued: [ids.B] });
    const detail = await request(app).get(`${BASE}/students/${ids.B}`).set(auth(viewer.token));
    expect(detail.body.data).toMatchObject({ syncStatus: 'PENDING', attempts: 0, lastErrorCode: null });
  });

  it('"Run now" answers 409 while the sync is switched off', async () => {
    const res = await request(app).post(`${BASE}/run`).set(auth(operator.token));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LMS_SYNC_DISABLED');
  });
});
