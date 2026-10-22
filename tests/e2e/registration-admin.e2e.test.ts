import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Express } from 'express';
import { AppDataSource } from '../../src/config/database.config';
import { HTTP_STATUS } from '../../src/constants/api-response.constants';
import { Student } from '../../src/database/entities';
import { auditService } from '../../src/modules/audit';
import { withVerhoeffDigit } from '../../src/modules/students/aadhaar';
import { documentStorage, storageRoot } from '../../src/modules/students/documents/document-storage';
import { StudentDocument } from '../../src/modules/students/documents/student-document.entity';
import { ROLE_CODES } from '../../src/modules/roles-permissions/role.constants';
import { API, actorWith, createUser, login, request, resetData, setupTestApp, superAdmin, teardownTestApp } from '../helpers/test-app';

let app: Express;
beforeAll(async () => {
  app = await setupTestApp();
});
beforeEach(async () => {
  await resetData();
  fs.rmSync(storageRoot(), { recursive: true, force: true });
});
afterAll(async () => {
  fs.rmSync(storageRoot(), { recursive: true, force: true });
  await teardownTestApp();
});

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

  it('shows full email, mobile and Aadhaar only to reviewers, and audits each view', async () => {
    const token = await sumagoToken();
    const body = await data();
    const id = (await post(token, body, await allMandatory())).body.data.id as string;

    const full = await request(app).get(`${URL}/${id}`).set('Authorization', `Bearer ${token}`);
    const digits = (body.aadhaar_number as string).replace(/\D/g, '');
    expect(full.body.data.unmasked).toEqual({
      email: body.email,
      mobile: `+91${body.mobile_number}`,
      currentAddress: body.current_address,
      aadhaar: digits.replace(/(\d{4})(?=\d)/g, '$1 '),
    });
    const audits = await AppDataSource.query(
      `SELECT 1 FROM "audit_logs" WHERE "action" = 'student.registration.unmasked_view' AND "resourceId" = $1`,
      [id],
    );
    expect(audits.length).toBe(1);

    const viewer = await actorWith(['registrations.view']);
    const masked = await request(app).get(`${URL}/${id}`).set('Authorization', `Bearer ${viewer.token}`);
    expect(masked.body.data.unmasked).toBeUndefined();
    expect(JSON.stringify(masked.body)).not.toContain(digits);
  });

  it('lists full email and mobile only for reviewers, with one audit row per list', async () => {
    const token = await sumagoToken();
    const body = await data();
    await post(token, body, await allMandatory());
    const list = await request(app).get(URL).set('Authorization', `Bearer ${token}`);
    const digits = (body.aadhaar_number as string).replace(/\D/g, '');
    expect(list.body.data[0].unmasked).toEqual({
      email: body.email,
      mobile: `+91${body.mobile_number}`,
      aadhaar: digits.replace(/(\d{4})(?=\d)/g, '$1 '),
    });
    const audits = await AppDataSource.query(`SELECT 1 FROM "audit_logs" WHERE "action" = 'student.registration.unmasked_list'`);
    expect(audits.length).toBe(1);

    const viewer = await actorWith(['registrations.view']);
    const masked = await request(app).get(URL).set('Authorization', `Bearer ${viewer.token}`);
    expect(masked.body.data[0].unmasked).toBeUndefined();
  });

  it('lists imported students and registrations together, with a source filter', async () => {
    const token = await sumagoToken();
    const reg = (await post(token, await data(), await allMandatory())).body.data.id as string;
    /* An imported student needs an approval date and an import batch (CHK_students_import_approved). */
    const [user] = await AppDataSource.query(`SELECT "id" FROM "users" LIMIT 1`);
    const [batch] = await AppDataSource.query(
      `INSERT INTO "import_batches" ("code", "status", "fileName", "fileChecksum", "fileSize", "createdById")
       VALUES ('IMP-TEST01', 'FINALISED', 'test.xlsx', repeat('a', 64), 1, $1) RETURNING "id"`,
      [user.id],
    );
    const [region] = await AppDataSource.query(`SELECT "id" FROM "regions" WHERE "code" = 'PUN'`);
    const [imp] = await AppDataSource.query(
      `INSERT INTO "students" ("code", "sourceChecksum", "firstName", "lastName", "fatherName", "motherName", "currentAddress",
         "religion", "caste", "centreCode", "regionId", "trackSourceValue", "educationQualification", "externalStatus",
         "approvedAt", "importBatchId", "source")
       VALUES ('STU-TEST01', repeat('0', 64), 'Imported', 'Student', 'F', 'M', 'A', 'हिंदू', 'मराठी', 'PUN', $1, 'T03', 'B.Com',
         'APPROVED', now(), $2, 'IMPORT')
       RETURNING "id"`,
      [region.id, batch.id],
    );

    const all = await request(app).get(URL).set('Authorization', `Bearer ${token}`);
    const sources = new Map(all.body.data.map((r: { id: string; source: string }) => [r.id, r.source]));
    expect(sources.get(reg)).toBe('PUBLIC_REGISTRATION');
    expect(sources.get(imp.id)).toBe('IMPORT');

    const onlyImport = await request(app).get(URL).query({ source: 'IMPORT' }).set('Authorization', `Bearer ${token}`);
    expect(onlyImport.body.data.map((r: { id: string }) => r.id)).toEqual([imp.id]);
    const onlyReg = await request(app).get(URL).query({ source: 'PUBLIC_REGISTRATION' }).set('Authorization', `Bearer ${token}`);
    expect(onlyReg.body.data.map((r: { id: string }) => r.id)).toEqual([reg]);

    const detail = await request(app).get(`${URL}/${imp.id}`).set('Authorization', `Bearer ${token}`);
    expect(detail.body.data).toMatchObject({ code: 'STU-TEST01', source: 'IMPORT' });
  });

  it('edits, deactivates and soft-deletes a student (audited, permission-checked)', async () => {
    const token = await sumagoToken();
    const body = await data();
    const id = (await post(token, body, await allMandatory())).body.data.id as string;
    const { barcodes: _b, declaration_accepted: _d, ...editable } = body as Record<string, unknown>;

    const edited = await request(app)
      .patch(`${URL}/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ...editable, first_name: 'Kavita', mobile_number: '9123456789' });
    expect(edited.status).toBe(HTTP_STATUS.OK);
    expect(edited.body.data).toMatchObject({ firstName: 'Kavita', regionId: body.region_id, isActive: true });
    expect(edited.body.data.unmasked.mobile).toBe('+919123456789');

    const bad = await request(app)
      .patch(`${URL}/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ...editable, email: 'x' });
    expect(bad.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);

    const off = await request(app).patch(`${URL}/${id}/status`).set('Authorization', `Bearer ${token}`).send({ isActive: false });
    expect(off.body.data.isActive).toBe(false);

    const viewer = await actorWith(['registrations.view']);
    expect((await request(app).delete(`${URL}/${id}`).set('Authorization', `Bearer ${viewer.token}`)).status).toBe(HTTP_STATUS.FORBIDDEN);
    const del = await request(app).delete(`${URL}/${id}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(HTTP_STATUS.OK);
    expect((await request(app).get(`${URL}/${id}`).set('Authorization', `Bearer ${token}`)).status).toBe(HTTP_STATUS.NOT_FOUND);
    const [row] = await AppDataSource.query(`SELECT "isDelete", "isActive" FROM "students" WHERE "id" = $1`, [id]);
    expect(row).toEqual({ isDelete: true, isActive: false });

    const actions = (await AppDataSource.query(`SELECT "action" FROM "audit_logs" WHERE "resourceId" = $1`, [id])).map(
      (r: { action: string }) => r.action,
    );
    expect(actions).toEqual(expect.arrayContaining(['student.update', 'student.status', 'student.delete']));
  });

  it('Student register (/students) shows imported and registered students, with a source filter', async () => {
    const token = await sumagoToken();
    const reg = (await post(token, await data(), await allMandatory())).body.data.id as string;
    const [user] = await AppDataSource.query(`SELECT "id" FROM "users" LIMIT 1`);
    const [batch] = await AppDataSource.query(
      `INSERT INTO "import_batches" ("code", "status", "fileName", "fileChecksum", "fileSize", "createdById")
       VALUES ('IMP-TEST02', 'FINALISED', 'test.xlsx', repeat('b', 64), 1, $1) RETURNING "id"`,
      [user.id],
    );
    const [imp] = await AppDataSource.query(
      `INSERT INTO "students" ("code", "sourceChecksum", "firstName", "lastName", "fatherName", "motherName", "currentAddress",
         "religion", "caste", "centreCode", "trackSourceValue", "educationQualification", "externalStatus",
         "approvedAt", "importBatchId", "source")
       VALUES ('STU-TEST02', repeat('0', 64), 'Imported', 'Student', 'F', 'M', 'A', 'हिंदू', 'मराठी', 'PUN', 'T03', 'B.Com',
         'APPROVED', now(), $1, 'IMPORT')
       RETURNING "id"`,
      [batch.id],
    );
    const STUDENTS = `${API}/students`;
    const all = await request(app).get(STUDENTS).set('Authorization', `Bearer ${token}`);
    const regInList = all.body.data.find((r: { id: string }) => r.id === reg);
    expect(regInList.unmasked.aadhaar).toMatch(/^\d{4} \d{4} \d{4}$/);
    const audits = await AppDataSource.query(`SELECT 1 FROM "audit_logs" WHERE "action" = 'student.register.unmasked_list'`);
    expect(audits.length).toBeGreaterThan(0);
    expect(all.status).toBe(HTTP_STATUS.OK);
    const byId = new Map(all.body.data.map((r: { id: string; source: string }) => [r.id, r.source]));
    expect(byId.get(reg)).toBe('PUBLIC_REGISTRATION');
    expect(byId.get(imp.id)).toBe('IMPORT');
    const regRow = all.body.data.find((r: { id: string }) => r.id === reg);
    expect(regRow.registrationNumber).toMatch(/^\d{16}$/);

    const onlyImport = await request(app).get(STUDENTS).query({ source: 'IMPORT' }).set('Authorization', `Bearer ${token}`);
    expect(onlyImport.body.data.map((r: { id: string }) => r.id)).toEqual([imp.id]);
    const onlyReg = await request(app).get(STUDENTS).query({ source: 'PUBLIC_REGISTRATION' }).set('Authorization', `Bearer ${token}`);
    expect(onlyReg.body.data.map((r: { id: string }) => r.id)).toEqual([reg]);
  });

  it('requires registrations.create to enter and registrations.view to list', async () => {
    const viewer = await actorWith(['registrations.view']);
    expect((await request(app).get(URL).set('Authorization', `Bearer ${viewer.token}`)).status).toBe(HTTP_STATUS.OK);
    expect((await post(viewer.token, await data(), {})).status).toBe(HTTP_STATUS.FORBIDDEN);
    expect((await request(app).get(URL)).status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });
});

describe('replacing documents on the edit form', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const NEW_PDF = Buffer.from('%PDF-1.4\n% replacement document\n%%EOF\n');
  const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
  const file = (key: string) => path.join(storageRoot(), ...key.split('/'));
  const staged = (code: string) => {
    const dir = file(`students/${code}/_staging`);
    return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  };
  /* Every row of one type, deleted or not. */
  const rowsOf = (id: string, docType: string): Promise<StudentDocument[]> =>
    AppDataSource.query(`SELECT * FROM "student_documents" WHERE "studentId" = $1 AND "docType" = $2`, [id, docType]);
  const rowById = async (docId: string): Promise<StudentDocument | undefined> =>
    (await AppDataSource.query(`SELECT * FROM "student_documents" WHERE "id" = $1`, [docId]))[0];
  /* Advisory locks still held by any session (the per-student documents lock must always be released). */
  const advisoryLocks = async () =>
    Number(
      (
        await AppDataSource.query(
          `SELECT COUNT(*) AS n FROM pg_locks l JOIN pg_database d ON d.oid = l.database
           WHERE l.locktype = 'advisory' AND d.datname = current_database()`,
        )
      )[0].n,
    );

  async function student(token: string) {
    const id = (await post(token, await data(), await allMandatory())).body.data.id as string;
    const detail = (await request(app).get(`${URL}/${id}`).set('Authorization', `Bearer ${token}`)).body.data;
    const fileOf = (docType: string) => detail.files.find((f: { docType: string }) => f.docType === docType);
    return { id, code: detail.code as string, photo: fileOf('PHOTO'), signature: fileOf('SIGNATURE') };
  }
  function replace(token: string, id: string, files: Record<string, { buf: Buffer; name: string }>, body?: unknown) {
    const r = request(app).post(`${URL}/${id}/documents`).set('Authorization', `Bearer ${token}`);
    if (body !== undefined) r.field('data', JSON.stringify(body));
    for (const [code, f] of Object.entries(files)) r.attach(code, f.buf, f.name);
    return r;
  }
  const download = (token: string, id: string, docId: string) =>
    request(app)
      .get(`${URL}/${id}/documents/${docId}/file`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((res, cb) => {
        const c: Buffer[] = [];
        res.on('data', (x: Buffer) => c.push(x));
        res.on('end', () => cb(null, Buffer.concat(c)));
      });

  it('deletes the old document (record and file), stores the new one unverified, updates barcodes, and keeps the rules', async () => {
    const token = await sumagoToken();
    const { id, code, photo: oldPhoto, signature } = await student(token);
    await request(app).post(`${URL}/${id}/documents/${oldPhoto.id}/verify`).set('Authorization', `Bearer ${token}`);
    const finalKey = `students/${code}/PHOTO.pdf`;
    expect((await rowById(oldPhoto.id))?.storageKey).toBe(finalKey);
    expect(fs.readFileSync(file(finalKey))).toEqual(PDF);

    /* Same extension: the new file takes the old one's key. */
    const res = await replace(token, id, { PHOTO: { buf: NEW_PDF, name: 'new-photo.pdf' } }, { barcodes: { INCOME_EWS: 'EWS-NEW-1' } });
    expect(res.status).toBe(HTTP_STATUS.OK);
    const photos = res.body.data.files.filter((f: { docType: string }) => f.docType === 'PHOTO');
    expect(photos).toEqual([expect.objectContaining({ originalName: 'new-photo.pdf', mimeType: 'application/pdf', verifiedAt: null })]);
    expect(photos[0].id).not.toBe(oldPhoto.id);
    const ews = res.body.data.documents.find((d: { key: string }) => d.key === 'INCOME_EWS');
    expect(ews.barcode).toBe('EWS-NEW-1');

    /* The old record is gone (not soft-deleted) and the file at the key is the new one; nothing is left in staging. */
    expect(await rowById(oldPhoto.id)).toBeUndefined();
    const rows = await rowsOf(id, 'PHOTO');
    expect(rows.map((r) => [r.id, r.storageKey, r.isDelete, r.verifiedAt])).toEqual([[photos[0].id, finalKey, false, null]]);
    expect(fs.readFileSync(file(finalKey))).toEqual(NEW_PDF);
    expect(fs.existsSync(file(`students/${code}/_replaced`))).toBe(false);
    expect(staged(code)).toEqual([]);
    const dl = await download(token, id, photos[0].id);
    expect(dl.status).toBe(HTTP_STATUS.OK);
    expect(dl.body).toEqual(NEW_PDF);

    /* Other document types are untouched. */
    expect((await rowsOf(id, 'SIGNATURE')).map((r) => r.id)).toEqual([signature.id]);
    const detail = await request(app).get(`${URL}/${id}`).set('Authorization', `Bearer ${token}`);
    const detailPhotos = detail.body.data.files.filter((f: { docType: string }) => f.docType === 'PHOTO');
    expect(detailPhotos.map((f: { id: string }) => f.id)).toEqual([photos[0].id]);

    const [audit] = await AppDataSource.query(
      `SELECT "details" FROM "audit_logs" WHERE "action" = 'student.documents.update' AND "resourceId" = $1`,
      [id],
    );
    expect(audit.details).toEqual({
      code,
      uploaded: ['PHOTO'],
      replaced: [{ docType: 'PHOTO', originalName: 'photo.pdf', sizeBytes: PDF.length, sha256: sha256(PDF) }],
      deleted: true,
      barcodes: ['INCOME_EWS'],
    });

    const badFile = await replace(token, id, { SIGNATURE: { buf: Buffer.from('MZ not a document'), name: 'sig.png' } });
    expect(badFile.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(badFile.body.error.details.map((d: { field: string }) => d.field)).toEqual(['files.SIGNATURE']);

    const noBarcode = await replace(token, id, {}, { barcodes: { INCOME_EWS: '' } });
    expect(noBarcode.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(noBarcode.body.error.details.map((d: { field: string }) => d.field)).toEqual(['body.barcodes.INCOME_EWS']);

    const viewer = await actorWith(['registrations.view']);
    const denied = await replace(viewer.token, id, { PHOTO: { buf: PNG, name: 'p.png' } });
    expect(denied.status).toBe(HTTP_STATUS.FORBIDDEN);
  });

  it('replacing with a different file type leaves only the new file, at <TYPE>.<new ext>', async () => {
    const token = await sumagoToken();
    const { id, code, photo: oldPhoto } = await student(token);
    expect(fs.existsSync(file(`students/${code}/PHOTO.pdf`))).toBe(true);

    const res = await replace(token, id, { PHOTO: { buf: PNG, name: 'new-photo.png' } });
    expect(res.status).toBe(HTTP_STATUS.OK);
    const photos = res.body.data.files.filter((f: { docType: string }) => f.docType === 'PHOTO');
    expect(photos).toEqual([expect.objectContaining({ originalName: 'new-photo.png', mimeType: 'image/png', verifiedAt: null })]);

    expect(await rowById(oldPhoto.id)).toBeUndefined();
    expect((await rowsOf(id, 'PHOTO')).map((r) => r.storageKey)).toEqual([`students/${code}/PHOTO.png`]);
    expect(fs.existsSync(file(`students/${code}/PHOTO.pdf`))).toBe(false);
    expect(fs.readFileSync(file(`students/${code}/PHOTO.png`))).toEqual(PNG);
    expect(fs.readdirSync(file(`students/${code}`)).filter((n) => n.startsWith('PHOTO'))).toEqual(['PHOTO.png']);
    expect(staged(code)).toEqual([]);
    const dl = await download(token, id, photos[0].id);
    expect(dl.headers['content-type']).toBe('image/png');
    expect(dl.body).toEqual(PNG);
  });

  it('a rejected replace (missing barcode or an invalid file) leaves the old document, record and file untouched', async () => {
    const token = await sumagoToken();
    const { id, code, photo } = await student(token);
    await request(app).post(`${URL}/${id}/documents/${photo.id}/verify`).set('Authorization', `Bearer ${token}`);
    const before = await rowById(photo.id);
    expect(before).toMatchObject({ isDelete: false, verifiedAt: expect.any(Date), storageKey: `students/${code}/PHOTO.pdf` });

    const noBarcode = await replace(token, id, { PHOTO: { buf: PNG, name: 'p.png' } }, { barcodes: { INCOME_EWS: '' } });
    expect(noBarcode.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    const badFile = await replace(token, id, {
      PHOTO: { buf: PNG, name: 'p.png' },
      SIGNATURE: { buf: Buffer.from('MZ not a document'), name: 'sig.png' },
    });
    expect(badFile.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);

    expect(await rowsOf(id, 'PHOTO')).toEqual([before]);
    expect(fs.readFileSync(file(`students/${code}/PHOTO.pdf`))).toEqual(PDF);
    expect(fs.existsSync(file(`students/${code}/PHOTO.png`))).toBe(false);
    expect(staged(code)).toEqual([]);
    const audits = await AppDataSource.query(`SELECT 1 FROM "audit_logs" WHERE "action" = 'student.documents.update'`);
    expect(audits).toEqual([]);
  });

  it('a database failure after the new file was staged removes the staged file and keeps the old document', async () => {
    const token = await sumagoToken();
    const { id, code, photo } = await student(token);
    const before = await rowById(photo.id);
    const write = jest.spyOn(documentStorage, 'write');
    const audit = jest.spyOn(auditService, 'recordInTx').mockRejectedValueOnce(new Error('simulated database failure'));
    try {
      const res = await replace(token, id, { PHOTO: { buf: PNG, name: 'p.png' } });
      expect(res.status).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
      const stagedKey = write.mock.calls.map(([key]) => key).find((key) => key.includes('/_staging/'));
      expect(stagedKey).toMatch(new RegExp(`^students/${code}/_staging/\\d+-[0-9a-f]{8}-PHOTO\\.png$`));
      expect(fs.existsSync(file(stagedKey!))).toBe(false);
    } finally {
      write.mockRestore();
      audit.mockRestore();
    }
    expect(await rowsOf(id, 'PHOTO')).toEqual([before]);
    expect(fs.readFileSync(file(`students/${code}/PHOTO.pdf`))).toEqual(PDF);
    expect(fs.existsSync(file(`students/${code}/PHOTO.png`))).toBe(false);
    expect(staged(code)).toEqual([]);
    expect(await advisoryLocks()).toBe(0);
  });

  it('a new file that cannot be moved into place after the commit stays downloadable from its staging key', async () => {
    const token = await sumagoToken();
    const { id, code, photo } = await student(token);
    const move = jest.spyOn(documentStorage, 'move').mockRejectedValueOnce(new Error('simulated storage failure'));
    try {
      const res = await replace(token, id, { PHOTO: { buf: PNG, name: 'p.png' } });
      expect(res.status).toBe(HTTP_STATUS.OK);
    } finally {
      move.mockRestore();
    }
    expect(await rowById(photo.id)).toBeUndefined();
    expect(fs.existsSync(file(`students/${code}/PHOTO.pdf`))).toBe(false);
    const [row] = await rowsOf(id, 'PHOTO');
    expect(row!.storageKey).toMatch(new RegExp(`^students/${code}/_staging/`));
    expect(fs.readFileSync(file(row!.storageKey))).toEqual(PNG);
    const dl = await download(token, id, row!.id);
    expect(dl.status).toBe(HTTP_STATUS.OK);
    expect(dl.body).toEqual(PNG);
    expect(await advisoryLocks()).toBe(0);
  });

  it('two replacements of the same document at once leave one record whose file is in place, with no stray files', async () => {
    const token = await sumagoToken();
    const { id, code } = await student(token);
    /* The first request's move into place is held back, so the second one runs while the first is still moving files. */
    const realMove = documentStorage.move;
    const move = jest.spyOn(documentStorage, 'move').mockImplementationOnce(async (from, to) => {
      await new Promise((r) => setTimeout(r, 1000));
      return realMove(from, to);
    });
    try {
      const results = await Promise.all([
        replace(token, id, { PHOTO: { buf: PNG, name: 'a.png' } }),
        replace(token, id, { PHOTO: { buf: NEW_PDF, name: 'b.pdf' } }),
      ]);
      expect(results.map((r) => r.status)).toEqual([HTTP_STATUS.OK, HTTP_STATUS.OK]);
    } finally {
      move.mockRestore();
    }
    const rows = await rowsOf(id, 'PHOTO');
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row!.storageKey).toMatch(new RegExp(`^students/${code}/PHOTO\\.(png|pdf)$`));
    expect(sha256(fs.readFileSync(file(row!.storageKey)))).toBe(row!.sha256);
    expect(fs.readdirSync(file(`students/${code}`)).filter((n) => n.startsWith('PHOTO'))).toEqual([row!.storageKey.split('/').pop()]);
    expect(staged(code)).toEqual([]);
    expect(await advisoryLocks()).toBe(0);
  });
});
