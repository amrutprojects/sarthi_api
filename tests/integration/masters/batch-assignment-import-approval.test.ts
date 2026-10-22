import type { Express } from 'express';
import { AppDataSource } from '../../../src/config/database.config';
import { HTTP_STATUS } from '../../../src/constants/api-response.constants';
import { withVerhoeffDigit } from '../../../src/modules/students/aadhaar';
import { IMPORT_COLUMNS } from '../../../src/modules/students/student.constants';
import { ROLE_CODES } from '../../../src/modules/roles-permissions/role.constants';
import { API, actorWith, auth, createUser, login, request, resetData, setupTestApp, teardownTestApp } from '../../helpers/test-app';

/*
 * An approved import row reconciled SAME_PERSON onto a pending public registration approves that registration when the
 * import is finalised: it becomes RECEIVED with the row's approval evidence, so Assign Batch (RECEIVED students only)
 * offers and assigns it. An imported student linked the same way keeps its own approval.
 * Fixtures follow tests/e2e/student-import.e2e.test.ts and tests/integration/masters/batch-assignment-students.test.ts.
 */
let app: Express;
beforeAll(async () => {
  app = await setupTestApp();
});
beforeEach(resetData);
afterAll(teardownTestApp);

const ASSIGN_URL = `${API}/cms/batch-assignments`;
const REG_URL = `${API}/student-registrations`;
const PDF = Buffer.from('%PDF-1.4\n% test document\n%%EOF\n');
const HEADER = IMPORT_COLUMNS.map((c) => c.field);
const APPROVED_AT = '2026-01-10T06:30:00Z';
let seq = 0;

const aadhaar = () => withVerhoeffDigit(`4567890${String(10000 + ++seq).slice(-4)}`);

async function masterId(table: string, code: string): Promise<string> {
  const [row] = await AppDataSource.query(`SELECT "id" FROM "${table}" WHERE "code" = $1 OR "name" = $1`, [code]);
  return row.id;
}

interface People {
  registrar: string;
  operator: string;
  reviewer: string;
  reviewerId: string;
  assigner: string;
}

/* Registrations are entered by SUMAGO Super Admin; an import is uploaded by one user and decided and finalised by another. */
async function people(): Promise<People> {
  const registrar = await createUser({ roleCodes: [ROLE_CODES.SUMAGO_SUPER_ADMIN] });
  const operator = await createUser({ roleCodes: ['IMPORT_OPERATOR'] });
  const reviewer = await createUser({ roleCodes: ['IMPORT_REVIEWER'] });
  const assigner = await actorWith(['view', 'create'].map((a) => `cms-batch-assignments.${a}`));
  return {
    registrar: await login(registrar.email),
    operator: await login(operator.email),
    reviewer: await login(reviewer.email),
    reviewerId: reviewer.id,
    assigner: assigner.token,
  };
}

/* A public-style registration entered through the admin API: stored in students as REGISTRATION_PENDING. */
async function pendingRegistrant(token: string, aadhaarNumber: string): Promise<string> {
  const n = ++seq;
  const body = {
    first_name: 'Kavya',
    last_name: 'Jadhav',
    father_name: 'Suresh Jadhav',
    mother_name: 'Meena Jadhav',
    email: `pending${n}@example.invalid`,
    date_of_birth: '2002-06-01',
    current_address: 'Kothrud, Pune',
    aadhaar_number: aadhaarNumber,
    mobile_number: `97654${String(10000 + n).slice(-5)}`,
    religion: 'हिंदू',
    caste_id: await masterId('castes', 'मराठी'),
    region_id: await masterId('regions', 'PUN'),
    technology: 'T03',
    education_id: await masterId('educations', 'B.Com'),
    declaration_accepted: true,
    barcodes: { INCOME_EWS: 'EWS-2026-0001' },
  };
  const mandatory: { code: string }[] = await AppDataSource.query(
    `SELECT "code" FROM "document_types" WHERE "isMandatory" AND "isActive" AND NOT "isDelete"`,
  );
  const r = request(app).post(`${REG_URL}/admin`).set(auth(token)).field('data', JSON.stringify(body));
  for (const { code } of mandatory) r.attach(code, PDF, `${code.toLowerCase()}.pdf`);
  const res = await r;
  expect(res.status).toBe(HTTP_STATUS.CREATED);
  expect(res.body.data.status).toBe('REGISTRATION_PENDING');
  return res.body.data.id as string;
}

/* One approved import row for the same candidate (name and date of birth as registered), documents flagged as supplied. */
function record(over: Record<string, string> = {}): Record<string, string> {
  const n = ++seq;
  const v: Record<string, string> = {
    source_record_id: `MA-AP-${n}`,
    first_name: 'Kavya',
    last_name: 'Jadhav',
    father_name: 'Suresh Jadhav',
    mother_name: 'Meena Jadhav',
    email: `import${n}@example.invalid`,
    date_of_birth: '2002-06-01',
    current_address: 'Kothrud, Pune',
    aadhaar_number: aadhaar(),
    mobile_number: `+91 98${String(10000000 + n).slice(-8)}`,
    religion: 'हिंदू',
    caste: 'मराठी',
    course_centre: 'Pune',
    technology: 'Cyber Security',
    education_qualification: 'Graduate',
    approval_status: 'APPROVED',
    approved_at: APPROVED_AT,
  };
  for (const f of HEADER.filter((h) => h.startsWith('doc_') && !h.endsWith('_barcode'))) v[f] = 'Yes';
  v.doc_income_ews_barcode = 'BC-1';
  return { ...v, ...over };
}
const csv = (rows: Record<string, string>[]) =>
  Buffer.from([HEADER.join(','), ...rows.map((r) => HEADER.map((h) => `"${(r[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n'));

async function upload(token: string, rec: Record<string, string>, name: string) {
  const res = await request(app)
    .post(`${API}/imports`)
    .set(auth(token))
    .attach('file', csv([rec]), name);
  expect(res.status).toBe(HTTP_STATUS.CREATED);
  return res.body.data as { id: string; code: string; status: string };
}

const finalise = (token: string, batch: { id: string; code: string }) =>
  request(app).post(`${API}/imports/${batch.id}/finalise`).set(auth(token)).send({ confirmCode: batch.code });

/* Upload one row that matches an existing student on Aadhaar (T1), decide SAME_PERSON and finalise, as the reviewer. */
async function importSamePerson(t: People, rec: Record<string, string>, name: string) {
  const batch = await upload(t.operator, rec, name);
  const [row] = (await request(app).get(`${API}/imports/${batch.id}/rows`).set(auth(t.operator))).body.data;
  expect(row).toMatchObject({ status: 'POSSIBLE_DUPLICATE', match: { tier: 'T1' } });
  const decided = await request(app)
    .post(`${API}/imports/${batch.id}/rows/${row.id}/decide`)
    .set(auth(t.reviewer))
    .send({ decision: 'SAME_PERSON', reason: 'Same person as the existing record' });
  expect(decided.body.data.status).toBe('VALID');
  const fin = await finalise(t.reviewer, batch);
  expect(fin.status).toBe(HTTP_STATUS.OK);
  expect(fin.body.data.counts).toMatchObject({ created: 0, linked: 1 });
  return { batch, matchStudentId: row.match.studentId as string };
}

/* An OPEN batch (capacity 30) at an active training centre, TC0001. */
async function openBatch(): Promise<string> {
  const [state] = await AppDataSource.query(`INSERT INTO "states" ("name", "code") VALUES ('Maharashtra', 'MH') RETURNING "id"`);
  const [district] = await AppDataSource.query(
    `INSERT INTO "districts" ("stateId", "name", "code") VALUES ($1, 'Pune', 'PUNE') RETURNING "id"`,
    [state.id],
  );
  const [centre] = await AppDataSource.query(
    `INSERT INTO "training_centres" ("name", "code", "districtId") VALUES ('Pune Centre', 'TC0001', $1) RETURNING "id"`,
    [district.id],
  );
  const [batch] = await AppDataSource.query(
    `INSERT INTO "batches" ("centreId", "name", "code", "capacity", "startDate", "deliveryMode", "batchStatus")
     VALUES ($1, 'Batch A', 'AMK-B-TC0001-001', 30, '2026-11-01', 'OFFLINE', 'OPEN') RETURNING "id"`,
    [centre.id],
  );
  return batch.id as string;
}

const studentRow = async (id: string) =>
  (
    await AppDataSource.query(
      `SELECT "code", "status", "source", "externalStatus", "approvedAt", "evidenceRef" FROM "students" WHERE "id" = $1`,
      [id],
    )
  )[0];

const promotionAudits = () =>
  AppDataSource.query(`SELECT "actorUserId", "resourceId", "details" FROM "audit_logs" WHERE "action" = 'student.registration.promoted'`);

describe('Import finalisation approves a pending registration linked as the same person', () => {
  it('makes the registration RECEIVED with the approved row, so Assign Batch offers it and assigns it (201)', async () => {
    const t = await people();
    const aadhaarA = aadhaar();
    const studentId = await pendingRegistrant(t.registrar, aadhaarA);
    const options = async (): Promise<string[]> => {
      const res = await request(app).get(`${ASSIGN_URL}/student-options`).query({ search: 'Jadhav' }).set(auth(t.assigner));
      expect(res.status).toBe(HTTP_STATUS.OK);
      return res.body.data.map((s: { id: string }) => s.id);
    };
    expect(await options()).not.toContain(studentId);

    /* Same Aadhaar, decided SAME_PERSON and finalised by the reviewer (not the uploader). */
    const { batch, matchStudentId } = await importSamePerson(
      t,
      record({ aadhaar_number: aadhaarA, evidence_ref: 'EV-2026-0042' }),
      'roster.csv',
    );
    expect(matchStudentId).toBe(studentId);

    const student = await studentRow(studentId);
    expect(student).toMatchObject({
      status: 'RECEIVED',
      externalStatus: 'APPROVED',
      evidenceRef: 'EV-2026-0042',
      source: 'PUBLIC_REGISTRATION',
    });
    expect(student.code).toMatch(/^REG-\d{6}$/);
    expect(new Date(student.approvedAt).toISOString()).toBe(new Date(APPROVED_AT).toISOString());
    expect(await promotionAudits()).toEqual([
      { actorUserId: t.reviewerId, resourceId: studentId, details: { importBatchId: batch.id, batchCode: batch.code, rowNumber: 2 } },
    ]);

    expect(await options()).toContain(studentId);
    const batchId = await openBatch();
    const res = await request(app).post(ASSIGN_URL).set(auth(t.assigner)).send({ batchId, studentId, reasonCode: 'OTHER' });
    expect(res.status).toBe(HTTP_STATUS.CREATED);
    expect(res.body.data).toMatchObject({ studentId, batchId, isActive: true });
  });

  it("leaves an imported student's own approval untouched when a later import row is linked to it", async () => {
    const t = await people();
    const first = record({ evidence_ref: 'EV-FIRST' });
    const fin = await finalise(t.reviewer, await upload(t.operator, first, 'first.csv'));
    expect(fin.body.data.counts).toMatchObject({ created: 1 });

    const { matchStudentId } = await importSamePerson(
      t,
      { ...first, source_record_id: 'MA-AP-NEW', approved_at: '2025-12-01T00:00:00Z', evidence_ref: 'EV-SECOND' },
      'second.csv',
    );
    const student = await studentRow(matchStudentId);
    expect(student).toMatchObject({ status: 'RECEIVED', externalStatus: 'APPROVED', evidenceRef: 'EV-FIRST', source: 'IMPORT' });
    expect(new Date(student.approvedAt).toISOString()).toBe(new Date(APPROVED_AT).toISOString());
    expect(await promotionAudits()).toHaveLength(0);
  });
});
