import type { Express } from 'express';
import { AppDataSource } from '../../src/config/database.config';
import { HTTP_STATUS } from '../../src/constants/api-response.constants';
import { Student } from '../../src/database/entities';
import { withVerhoeffDigit } from '../../src/modules/students/aadhaar';
import { StudentDocument } from '../../src/modules/students/documents/student-document.entity';
import { ROLE_CODES } from '../../src/modules/roles-permissions/role.constants';
import { API, actorWith, createUser, login, request, resetData, setupTestApp, superAdmin, teardownTestApp } from '../helpers/test-app';

let app: Express;
beforeAll(async () => {
  app = await setupTestApp();
});
beforeEach(resetData);
afterAll(teardownTestApp);

const URL = `${API}/student-registrations`;
const PDF = Buffer.from('%PDF-1.4\n% test document\n%%EOF\n');
let seq = 0;

async function masterId(table: string, code: string): Promise<string> {
  const [row] = await AppDataSource.query(`SELECT "id" FROM "${table}" WHERE "code" = $1 OR "name" = $1`, [code]);
  return row.id;
}

async function data(over: Record<string, unknown> = {}) {
  const n = ++seq;
  return {
    first_name: 'Kavya',
    last_name: 'Jadhav',
    father_name: 'Suresh Jadhav',
    mother_name: 'Meena Jadhav',
    email: `kavya${n}@example.invalid`,
    date_of_birth: '2002-06-01',
    current_address: 'Kothrud, Pune',
    aadhaar_number: withVerhoeffDigit(`3456789${String(10000 + n).slice(-4)}`),
    mobile_number: `97654${String(10000 + n).slice(-5)}`,
    religion: 'हिंदू',
    caste_id: await masterId('castes', 'मराठी'),
    region_id: await masterId('regions', 'PUN'),
    technology: 'T03',
    education_id: await masterId('educations', 'B.Com'),
    declaration_accepted: true,
    barcodes: { INCOME_EWS: 'EWS-2026-0001' },
    ...over,
  };
}

const mandatoryCodes = async (): Promise<string[]> =>
  (await AppDataSource.query(`SELECT "code" FROM "document_types" WHERE "isMandatory" AND "isActive" AND NOT "isDelete"`)).map(
    (r: { code: string }) => r.code,
  );

async function sumagoToken(): Promise<string> {
  const user = await createUser({ roleCodes: [ROLE_CODES.SUMAGO_SUPER_ADMIN] });
  return login(user.email);
}

function post(token: string, body: unknown, files: Record<string, { buf: Buffer; name: string }>) {
  const r = request(app).post(`${URL}/admin`).set('Authorization', `Bearer ${token}`).field('data', JSON.stringify(body));
  for (const [code, f] of Object.entries(files)) r.attach(code, f.buf, f.name);
  return r;
}

const allMandatory = async (extra: Record<string, { buf: Buffer; name: string }> = {}) =>
  Object.fromEntries([...(await mandatoryCodes()).map((c) => [c, { buf: PDF, name: `${c.toLowerCase()}.pdf` }]), ...Object.entries(extra)]);

describe('SUMAGO Super Admin role', () => {
  it('holds the Student Registration permissions; Super Admin does not', async () => {
    const codes = async (role: string) =>
      (
        await AppDataSource.query(
          `SELECT p."code" FROM "role_permissions" rp JOIN "roles" r ON r."id" = rp."roleId" JOIN "permissions" p ON p."id" = rp."permissionId"
           WHERE r."code" = $1 AND NOT rp."isDelete"`,
          [role],
        )
      ).map((r: { code: string }) => r.code);
    const sumago = await codes(ROLE_CODES.SUMAGO_SUPER_ADMIN);
    const superAdminCodes = await codes(ROLE_CODES.SUPER_ADMIN);
    expect(sumago).toEqual(expect.arrayContaining(['registrations.view', 'registrations.create', 'users.view', 'roles.update']));
    expect(superAdminCodes.filter((c: string) => c.startsWith('registrations.'))).toEqual([]);
    expect(sumago.length).toBe(superAdminCodes.length + 5);

    const sa = await superAdmin();
    expect((await request(app).get(URL).set('Authorization', `Bearer ${sa.token}`)).status).toBe(HTTP_STATUS.FORBIDDEN);
  });
});

describe('admin registration entry with documents', () => {
  it('creates the registration, stores every file and lists it', async () => {
    const token = await sumagoToken();
    const res = await post(token, await data(), await allMandatory({ PAN_CARD: { buf: PDF, name: 'pan.PDF' } }));
    expect(res.status).toBe(HTTP_STATUS.CREATED);
    expect(res.body.data).toMatchObject({ registration_id: expect.stringMatching(/^REG-/), status: 'REGISTRATION_PENDING' });

    const student = await AppDataSource.getRepository(Student).findOneByOrFail({ id: res.body.data.id });
    expect(student.documents.INCOME_EWS).toMatchObject({ supplied: true, barcode: 'EWS-2026-0001' });
    expect(student.documents.PAN_CARD).toMatchObject({ supplied: true });
    const files = await AppDataSource.getRepository(StudentDocument).find({ where: { studentId: student.id } });
    expect(files.length).toBe((await mandatoryCodes()).length + 1);
    expect(files.every((f) => f.batchId === null && f.mimeType === 'application/pdf')).toBe(true);

    const list = await request(app).get(URL).query({ search: 'Kavya' }).set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(HTTP_STATUS.OK);
    expect(list.body.data.map((r: { id: string }) => r.id)).toEqual([student.id]);
    expect(list.body.data[0].aadhaar).toMatch(/^XXXX-XXXX-\d{4}$/);

    const detail = await request(app).get(`${URL}/${student.id}`).set('Authorization', `Bearer ${token}`);
    expect(detail.body.data.files.map((f: { docType: string }) => f.docType)).toContain('PAN_CARD');
  });

  it('rejects missing mandatory files, wrong file types, missing barcodes and bad fields together', async () => {
    const token = await sumagoToken();
    const files = await allMandatory({ PHOTO: { buf: Buffer.from('MZ not an image'), name: 'photo.jpg' } });
    delete files.SIGNATURE;
    const res = await post(token, await data({ barcodes: {}, email: 'nope' }), files);
    expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    const fields = res.body.error.details.map((d: { field: string }) => d.field).sort();
    expect(fields).toEqual(['body.barcodes.INCOME_EWS', 'body.email', 'files.PHOTO', 'files.SIGNATURE']);
    expect(await AppDataSource.getRepository(Student).count()).toBe(0);
  });

  it('rejects files over 5 MB and unknown document types', async () => {
    const token = await sumagoToken();
    const big = Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]);
    const tooBig = await post(token, await data(), await allMandatory({ PHOTO: { buf: big, name: 'photo.pdf' } }));
    expect(tooBig.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(tooBig.body.error.details[0].field).toBe('files.PHOTO');

    const unknown = await post(token, await data(), await allMandatory({ PASSPORT: { buf: PDF, name: 'p.pdf' } }));
    expect(unknown.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(unknown.body.error.details.map((d: { field: string }) => d.field)).toEqual(['files.PASSPORT']);
  });

  it('verifies one document (audited, idempotent) and shows who verified it', async () => {
    const token = await sumagoToken();
    const created = await post(token, await data(), await allMandatory());
    const id = created.body.data.id as string;
    const detail = await request(app).get(`${URL}/${id}`).set('Authorization', `Bearer ${token}`);
    const photo = detail.body.data.files.find((f: { docType: string }) => f.docType === 'PHOTO');
    expect(photo.verifiedAt).toBeNull();

    const v1 = await request(app).post(`${URL}/${id}/documents/${photo.id}/verify`).set('Authorization', `Bearer ${token}`);
    expect(v1.status).toBe(HTTP_STATUS.OK);
    expect(v1.body.data).toMatchObject({ id: photo.id, verifiedAt: expect.any(String), verifiedBy: expect.any(String) });
    const v2 = await request(app).post(`${URL}/${id}/documents/${photo.id}/verify`).set('Authorization', `Bearer ${token}`);
    expect(v2.body.data.verifiedAt).toBe(v1.body.data.verifiedAt);

    const viewer = await actorWith(['registrations.view']);
    const denied = await request(app).post(`${URL}/${id}/documents/${photo.id}/verify`).set('Authorization', `Bearer ${viewer.token}`);
    expect(denied.status).toBe(HTTP_STATUS.FORBIDDEN);
  });

  it('requires registrations.create to enter and registrations.view to list', async () => {
    const viewer = await actorWith(['registrations.view']);
    expect((await request(app).get(URL).set('Authorization', `Bearer ${viewer.token}`)).status).toBe(HTTP_STATUS.OK);
    expect((await post(viewer.token, await data(), {})).status).toBe(HTTP_STATUS.FORBIDDEN);
    expect((await request(app).get(URL)).status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });
});
