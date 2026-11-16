import type { Express } from 'express';
import { AppDataSource } from '../../../src/config/database.config';
import { HTTP_STATUS } from '../../../src/constants/api-response.constants';
import { withVerhoeffDigit } from '../../../src/modules/students/aadhaar';
import { ROLE_CODES } from '../../../src/modules/roles-permissions/role.constants';
import { API, actorWith, createUser, login, request, resetData, setupTestApp, teardownTestApp } from '../../helpers/test-app';

/*
 * Assign Batch meets the student register: only registered students (status RECEIVED) can be searched for and
 * assigned, never a pending public registration; and a student cannot be deleted while a batch assignment
 * references it (it would keep holding a seat).
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
let seq = 0;

const bearer = (token: string) => `Bearer ${token}`;

async function masterId(table: string, code: string): Promise<string> {
  const [row] = await AppDataSource.query(`SELECT "id" FROM "${table}" WHERE "code" = $1 OR "name" = $1`, [code]);
  return row.id;
}

/* SUMAGO Super Admin holds the registrations.* permissions (create a registration, delete a student). */
async function registrar(): Promise<{ id: string; token: string }> {
  const user = await createUser({ roleCodes: [ROLE_CODES.SUMAGO_SUPER_ADMIN] });
  return { id: user.id, token: await login(user.email) };
}

async function assigner(): Promise<string> {
  const actor = await actorWith(['view', 'create', 'update', 'delete'].map((a) => `cms-batch-assignments.${a}`));
  return actor.token;
}

/* A real public-style registration entered through the admin API: stored in students as REGISTRATION_PENDING. */
async function pendingRegistrant(token: string, firstName: string, lastName: string): Promise<string> {
  const n = ++seq;
  const body = {
    first_name: firstName,
    last_name: lastName,
    father_name: 'Suresh Jadhav',
    mother_name: 'Meena Jadhav',
    email: `pending${n}@example.invalid`,
    date_of_birth: '2002-06-01',
    current_address: 'Kothrud, Pune',
    aadhaar_number: withVerhoeffDigit(`3456789${String(10000 + n).slice(-4)}`),
    mobile_number: `97654${String(10000 + n).slice(-5)}`,
    religion: 'हिंदू',
    caste_id: await masterId('castes', 'ब्राह्मण'),
    region_id: await masterId('regions', 'PUN'),
    technology: 'T03',
    education_id: await masterId('educations', 'B.Com'),
    declaration_accepted: true,
    barcodes: { INCOME_EWS: '271234567890123456', DOMICILE: '281234567890123456' },
  };
  const mandatory: { code: string }[] = await AppDataSource.query(
    `SELECT "code" FROM "document_types" WHERE "isMandatory" AND "isActive" AND NOT "isDelete"`,
  );
  const r = request(app).post(`${REG_URL}/admin`).set('Authorization', bearer(token)).field('data', JSON.stringify(body));
  for (const { code } of mandatory) r.attach(code, PDF, `${code.toLowerCase()}.pdf`);
  const res = await r;
  expect(res.status).toBe(HTTP_STATUS.CREATED);
  expect(res.body.data.status).toBe('REGISTRATION_PENDING');
  return res.body.data.id as string;
}

/* An imported, approved student (source IMPORT, status RECEIVED by default), as import finalisation writes it. */
async function registeredStudent(createdById: string, firstName: string, lastName: string, centreCode = 'TC0001'): Promise<string> {
  const n = ++seq;
  const [batch] = await AppDataSource.query(
    `INSERT INTO "import_batches" ("code", "status", "fileName", "fileChecksum", "fileSize", "createdById")
     VALUES ($1, 'FINALISED', 'students.xlsx', $2, 1, $3) RETURNING "id"`,
    [`IMP-T${n}`, String(n).padStart(64, '0'), createdById],
  );
  const [student] = await AppDataSource.query(
    `INSERT INTO "students" ("code", "sourceChecksum", "firstName", "lastName", "fatherName", "motherName", "currentAddress",
       "religion", "caste", "centreCode", "trackSourceValue", "educationQualification", "externalStatus", "approvedAt", "importBatchId")
     VALUES ($1, $2, $3, $4, 'Father', 'Mother', 'Nashik', 'Hindu', 'Maratha', $5, 'Data Science', 'Graduate', 'APPROVED', now(), $6)
     RETURNING "id", "status", "source"`,
    [`STU-T${n}`, String(n).padStart(64, 'a'), firstName, lastName, centreCode, batch.id],
  );
  expect(student).toMatchObject({ status: 'RECEIVED', source: 'IMPORT' });
  return student.id as string;
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

const assign = (token: string, batchId: string, studentId: string) =>
  request(app).post(ASSIGN_URL).set('Authorization', bearer(token)).send({ batchId, studentId, reasonCode: 'OTHER' });

const liveAssignments = async (studentId: string): Promise<number> =>
  (await AppDataSource.query(`SELECT count(*)::int AS "n" FROM "batch_assignments" WHERE "studentId" = $1 AND NOT "isDelete"`, [studentId]))[0].n;

describe('Assign Batch: only registered students', () => {
  it('leaves a pending registrant out of the student search', async () => {
    const reg = await registrar();
    const pendingId = await pendingRegistrant(reg.token, 'Kavya', 'Jadhav');
    const registeredId = await registeredStudent(reg.id, 'Kavita', 'Jadhav');

    const res = await request(app).get(`${ASSIGN_URL}/student-options`).query({ search: 'Jadhav' }).set('Authorization', bearer(await assigner()));
    expect(res.status).toBe(HTTP_STATUS.OK);
    const ids = res.body.data.map((s: { id: string }) => s.id);
    expect(ids).toEqual([registeredId]);
    expect(ids).not.toContain(pendingId);
  });

  it('refuses to assign a pending registrant (400 on studentId)', async () => {
    const reg = await registrar();
    const pendingId = await pendingRegistrant(reg.token, 'Kavya', 'Jadhav');
    const batchId = await openBatch();

    const res = await assign(await assigner(), batchId, pendingId);
    expect(res.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(res.body.error.details).toEqual([{ field: 'studentId', message: 'Only registered students can be assigned' }]);
    expect(await liveAssignments(pendingId)).toBe(0);
  });

  it('still assigns a registered (RECEIVED) student', async () => {
    const reg = await registrar();
    const studentId = await registeredStudent(reg.id, 'Kavita', 'Jadhav');
    const batchId = await openBatch();

    const res = await assign(await assigner(), batchId, studentId);
    expect(res.status).toBe(HTTP_STATUS.CREATED);
    expect(res.body.data).toMatchObject({ studentId, batchId, isActive: true });
    expect(await liveAssignments(studentId)).toBe(1);
  });

  it('refuses to re-activate or restore an assignment whose student is no longer a registered student', async () => {
    const reg = await registrar();
    const studentId = await registeredStudent(reg.id, 'Kavita', 'Jadhav');
    const batchId = await openBatch();
    const token = await assigner();
    const id = (await assign(token, batchId, studentId)).body.data.id as string;

    const off = await request(app).patch(`${ASSIGN_URL}/${id}/status`).set('Authorization', bearer(token)).send({ isActive: false });
    expect(off.status).toBe(HTTP_STATUS.OK);
    await AppDataSource.query(`UPDATE "students" SET "status" = 'REGISTRATION_PENDING' WHERE "id" = $1`, [studentId]);

    const on = await request(app).patch(`${ASSIGN_URL}/${id}/status`).set('Authorization', bearer(token)).send({ isActive: true });
    expect(on.status).toBe(HTTP_STATUS.CONFLICT);

    expect((await request(app).delete(`${ASSIGN_URL}/${id}`).set('Authorization', bearer(token))).status).toBe(HTTP_STATUS.OK);
    const restored = await request(app).post(`${ASSIGN_URL}/${id}/restore`).set('Authorization', bearer(token));
    expect(restored.status).toBe(HTTP_STATUS.CONFLICT);
    expect(await liveAssignments(studentId)).toBe(0);
  });
});

describe('Student delete while a batch assignment references the student', () => {
  it('refuses (409) while the assignment exists, active or not, and keeps the student', async () => {
    const reg = await registrar();
    const studentId = await registeredStudent(reg.id, 'Kavita', 'Jadhav');
    const batchId = await openBatch();
    const token = await assigner();
    const assignmentId = (await assign(token, batchId, studentId)).body.data.id as string;

    const del = await request(app).delete(`${REG_URL}/${studentId}`).set('Authorization', bearer(reg.token));
    expect(del.status).toBe(HTTP_STATUS.CONFLICT);

    /* An inactive assignment holds no seat but still references the student. */
    await request(app).patch(`${ASSIGN_URL}/${assignmentId}/status`).set('Authorization', bearer(token)).send({ isActive: false });
    expect((await request(app).delete(`${REG_URL}/${studentId}`).set('Authorization', bearer(reg.token))).status).toBe(HTTP_STATUS.CONFLICT);

    const [row] = await AppDataSource.query(`SELECT "isDelete", "isActive" FROM "students" WHERE "id" = $1`, [studentId]);
    expect(row).toEqual({ isDelete: false, isActive: true });
    const audits = await AppDataSource.query(`SELECT 1 FROM "audit_logs" WHERE "resourceId" = $1 AND "action" = 'student.delete'`, [studentId]);
    expect(audits).toHaveLength(0);
  });

  it('deletes the student once the assignment has been deleted', async () => {
    const reg = await registrar();
    const studentId = await registeredStudent(reg.id, 'Kavita', 'Jadhav');
    const batchId = await openBatch();
    const token = await assigner();
    const assignmentId = (await assign(token, batchId, studentId)).body.data.id as string;

    expect((await request(app).delete(`${ASSIGN_URL}/${assignmentId}`).set('Authorization', bearer(token))).status).toBe(HTTP_STATUS.OK);
    const del = await request(app).delete(`${REG_URL}/${studentId}`).set('Authorization', bearer(reg.token));
    expect(del.status).toBe(HTTP_STATUS.OK);

    const [row] = await AppDataSource.query(`SELECT "isDelete", "isActive" FROM "students" WHERE "id" = $1`, [studentId]);
    expect(row).toEqual({ isDelete: true, isActive: false });
    expect((await request(app).delete(`${REG_URL}/${studentId}`).set('Authorization', bearer(reg.token))).status).toBe(HTTP_STATUS.NOT_FOUND);
  });
});
