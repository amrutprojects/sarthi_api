import type { Express } from 'express';
import { AppDataSource } from '../../src/config/database.config';
import { IMPORT_COLUMNS } from '../../src/modules/students/student.constants';
import { Student } from '../../src/database/entities';
import { decryptAadhaar, verhoeffValid, withVerhoeffDigit } from '../../src/modules/students/aadhaar';
import { API, auth, createUser, login, request, resetData, setupTestApp, teardownTestApp } from '../helpers/test-app';

let app: Express;
beforeAll(async () => {
  app = await setupTestApp();
});
beforeEach(resetData);
afterAll(teardownTestApp);

const HEADER = IMPORT_COLUMNS.map((c) => c.field);
let seq = 0;
const aadhaar = () => withVerhoeffDigit(`2345678${String(10000 + ++seq).slice(-4)}`);

function record(over: Record<string, string> = {}): Record<string, string> {
  const n = ++seq;
  const letters = n.toString(26).replace(/\d/g, (d) => 'abcdefghij'[+d]);
  const v: Record<string, string> = {
    source_record_id: `MA-T-${n}`,
    first_name: 'Asha',
    last_name: `Tester${letters}`,
    father_name: 'Ramesh',
    mother_name: 'Sunita',
    email: `asha${n}@example.invalid`,
    date_of_birth: '2003-04-12',
    current_address: 'Flat 0, Test Lane',
    aadhaar_number: aadhaar(),
    mobile_number: `+91 98${String(10000000 + n).slice(-8)}`,
    religion: 'हिंदू',
    caste: 'ब्राह्मण',
    course_centre: 'Pune',
    technology: 'Cyber Security',
    education_qualification: 'Graduate',
    approval_status: 'APPROVED',
    approved_at: '2026-01-10T06:30:00Z',
  };
  for (const f of HEADER.filter((h) => h.startsWith('doc_') && !h.endsWith('_barcode'))) v[f] = 'Yes';
  v.doc_income_ews_barcode = '271234567890123456';
  v.doc_domicile_barcode = '281234567890123456';
  return { ...v, ...over };
}
const csv = (rows: Record<string, string>[], header = HEADER) =>
  Buffer.from([header.join(','), ...rows.map((r) => header.map((h) => `"${(r[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n'));

async function uploadAs(token: string, file: Buffer, name = 'students.csv') {
  return request(app).post(`${API}/imports`).set(auth(token)).attach('file', file, name);
}
async function people() {
  const operator = await createUser({ roleCodes: ['IMPORT_OPERATOR'] });
  const reviewer = await createUser({ roleCodes: ['IMPORT_REVIEWER'] });
  return { op: await login(operator.email), rv: await login(reviewer.email) };
}
const rowsOf = async (token: string, batchId: string, status?: string) =>
  (
    await request(app)
      .get(`${API}/imports/${batchId}/rows${status ? `?status=${status}` : ''}`)
      .set(auth(token))
  ).body.data;

describe('Verhoeff', () => {
  it('accepts generated numbers and rejects a changed digit', () => {
    const n = withVerhoeffDigit('23456789012');
    expect(verhoeffValid(n)).toBe(true);
    expect(verhoeffValid(n.slice(0, 11) + String((Number(n[11]) + 1) % 10))).toBe(false);
  });
});

describe('student import', () => {
  it('validates, is finalised by a second person, and creates masked students with encrypted Aadhaar', async () => {
    const { op, rv } = await people();
    const recs = [record(), record({ technology: 'AI-ML Engineer', course_centre: 'NAS' })];
    const up = await uploadAs(op, csv(recs));
    expect(up.status).toBe(201);
    expect(up.body.data.status).toBe('READY_TO_FINALISE');
    expect(up.body.data.counts).toMatchObject({ total: 2, valid: 2 });
    const batch = up.body.data;

    const rows = await rowsOf(op, batch.id);
    expect(rows[0].aadhaar).toMatch(/^XXXX-XXXX-\d{4}$/);
    expect(JSON.stringify(rows)).not.toContain(recs[0].aadhaar_number);

    /* The uploader cannot finalise; a wrong code is refused. */
    expect((await request(app).post(`${API}/imports/${batch.id}/finalise`).set(auth(op)).send({ confirmCode: batch.code })).status).toBe(
      403,
    );
    expect((await request(app).post(`${API}/imports/${batch.id}/finalise`).set(auth(rv)).send({ confirmCode: 'WRONG' })).status).toBe(400);
    const fin = await request(app).post(`${API}/imports/${batch.id}/finalise`).set(auth(rv)).send({ confirmCode: batch.code });
    expect(fin.status).toBe(200);
    expect(fin.body.data).toMatchObject({ status: 'FINALISED', counts: { created: 2, reconciled: 2 } });

    const reg = await request(app).get(`${API}/students`).set(auth(op));
    expect(reg.body.meta.total).toBe(2);
    expect(reg.body.data.map((s: { trackCode: string }) => s.trackCode).sort()).toEqual(['T07', 'T08']);
    expect(JSON.stringify(reg.body.data)).not.toContain(recs[0].aadhaar_number);

    const stored = await AppDataSource.getRepository(Student).findOneByOrFail({ sourceRecordId: recs[0].source_record_id });
    /* Imported students get a registration number too (MMDDHHmmssSSSfff), distinct per student. */
    expect(stored.registrationNumber).toMatch(/^\d{16}$/);
    const numbers = (await AppDataSource.getRepository(Student).find()).map((x) => x.registrationNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(decryptAadhaar(stored.aadhaarEnc!)).toBe(recs[0].aadhaar_number);
    expect(stored.mobile).toMatch(/^\+91[6-9]\d{9}$/);
  });

  it('returns the existing batch for the same file, and skips unchanged rows on a new file', async () => {
    const { op, rv } = await people();
    const r = record();
    const file = csv([r]);
    const first = await uploadAs(op, file);
    const again = await uploadAs(op, file);
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(first.body.data.id);
    await request(app).post(`${API}/imports/${first.body.data.id}/finalise`).set(auth(rv)).send({ confirmCode: first.body.data.code });

    const second = await uploadAs(op, csv([r, record()]), 'second.csv');
    expect(second.body.data.counts).toMatchObject({ skipped: 1, valid: 1 });
  });

  it('fails the batch when a required column is missing', async () => {
    const { op } = await people();
    const res = await uploadAs(
      op,
      csv(
        [record()],
        HEADER.filter((h) => h !== 'aadhaar_number'),
      ),
    );
    expect(res.body.data.status).toBe('IMPORT_FAILED');
    expect(res.body.data.failureReason).toMatch(/Aadhaar Number/);
  });

  it('raises exceptions; non-waivable must be rejected, waivable can be accepted with a reason', async () => {
    const { op, rv } = await people();
    const bad = record({ aadhaar_number: '123412341234', email: 'not-an-email' });
    const track = record({ technology: 'Accounting & Financial Management' });
    const up = await uploadAs(op, csv([bad, track]));
    expect(up.body.data.status).toBe('VALIDATED_WITH_EXCEPTIONS');
    const [rBad, rTrack] = await rowsOf(op, up.body.data.id);
    expect(rBad.issues.map((i: { code: string }) => i.code)).toEqual(expect.arrayContaining(['AADHAAR_INVALID', 'EMAIL_INVALID']));
    expect(JSON.stringify(rBad.issues)).not.toContain('123412341234');

    const base = `${API}/imports/${up.body.data.id}/rows`;
    expect((await request(app).post(`${base}/${rBad.id}/accept`).set(auth(op)).send({ reason: 'looks fine' })).status).toBe(400);
    expect((await request(app).post(`${base}/${rBad.id}/reject`).set(auth(op)).send({ reason: 'Invalid identity at source' })).status).toBe(
      200,
    );
    const acc = await request(app)
      .post(`${base}/${rTrack.id}/accept`)
      .set(auth(op))
      .send({ reason: 'Track to be confirmed after Module 1' });
    expect(acc.body.data.status).toBe('VALID');

    const batch = (await request(app).get(`${API}/imports/${up.body.data.id}`).set(auth(op))).body.data;
    expect(batch.status).toBe('READY_TO_FINALISE');
    await request(app).post(`${API}/imports/${batch.id}/finalise`).set(auth(rv)).send({ confirmCode: batch.code });
    const reg = (await request(app).get(`${API}/students?track=TBC`).set(auth(op))).body;
    expect(reg.meta.total).toBe(1);
    expect(reg.data[0].trackToBeConfirmed).toBe(true);
  });

  it('flags duplicates in the file and against the register, and needs a decision', async () => {
    const { op, rv } = await people();
    const r1 = record();
    const up1 = await uploadAs(op, csv([r1, { ...record(), aadhaar_number: r1.aadhaar_number }]));
    const [, dupRow] = await rowsOf(op, up1.body.data.id);
    expect(dupRow.issues[0].code).toBe('DUPLICATE_IN_FILE');
    await request(app)
      .post(`${API}/imports/${up1.body.data.id}/rows/${dupRow.id}/reject`)
      .set(auth(op))
      .send({ reason: 'Duplicate in file' });
    await request(app).post(`${API}/imports/${up1.body.data.id}/finalise`).set(auth(rv)).send({ confirmCode: up1.body.data.code });

    /* Same Aadhaar, new source ID → Tier 1 possible duplicate. */
    const up2 = await uploadAs(op, csv([{ ...r1, source_record_id: 'MA-NEW-1' }]), 'b.csv');
    const [m] = await rowsOf(op, up2.body.data.id);
    expect(m.status).toBe('POSSIBLE_DUPLICATE');
    expect(m.match.tier).toBe('T1');
    const dec = await request(app)
      .post(`${API}/imports/${up2.body.data.id}/rows/${m.id}/decide`)
      .set(auth(rv))
      .send({ decision: 'SAME_PERSON', reason: 'Same person, new application ID' });
    expect(dec.body.data.status).toBe('VALID');
    const fin = await request(app)
      .post(`${API}/imports/${up2.body.data.id}/finalise`)
      .set(auth(rv))
      .send({ confirmCode: up2.body.data.code });
    expect(fin.body.data.counts).toMatchObject({ created: 0, linked: 1 });
    expect((await request(app).get(`${API}/students`).set(auth(op))).body.meta.total).toBe(1);
  });

  it('serves CSV and Excel templates whose document paths match the sample ZIP; together they import cleanly', async () => {
    const { op } = await people();
    const download = (path: string) =>
      request(app)
        .get(`${API}/imports/${path}`)
        .set(auth(op))
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
    const csvTpl = await download('template.csv');
    const xlsxTpl = await download('template.xlsx');
    const zip = await download('sample-documents.zip');
    expect([csvTpl.status, xlsxTpl.status, zip.status]).toEqual([200, 200, 200]);
    expect((csvTpl.body as Buffer).subarray(0, 3).toString('hex')).toBe('efbbbf');
    expect((xlsxTpl.body as Buffer).subarray(0, 2).toString()).toBe('PK');

    /* Without the ZIP the rows wait for their documents. */
    const alone = await uploadAs(op, csvTpl.body as Buffer, 'template.csv');
    expect(alone.body.data.status).toBe('VALIDATED_WITH_EXCEPTIONS');
    const waiting = await rowsOf(op, alone.body.data.id);
    expect(waiting[0].issues.find((i: { code: string }) => i.code === 'DOC_MISSING').message).toMatch(
      /waiting for "MA-SYN-000001\/photo.jpg"/,
    );
    await request(app).post(`${API}/imports/${alone.body.data.id}/cancel`).set(auth(op));

    /* The Excel template with the sample ZIP: every referenced file is stored, nothing is left open. */
    const both = await request(app)
      .post(`${API}/imports`)
      .set(auth(op))
      .attach('file', xlsxTpl.body as Buffer, 'template.xlsx')
      .attach('documents', zip.body as Buffer, 'sample-documents.zip');
    expect(both.status).toBe(201);
    expect(both.body.data).toMatchObject({ status: 'READY_TO_FINALISE', counts: { total: 2, valid: 2 } });
    expect(both.body.data.documentsReport).toMatchObject({ rejected: [], missingReferenced: [], unmatchedFolders: [] });
    expect(both.body.data.documentsReport.matchedByPath).toBe(both.body.data.documentsReport.stored);
  });

  it('requires import permissions', async () => {
    const viewer = await createUser({ roleCodes: ['VIEWER'] });
    const token = await login(viewer.email);
    const res = await uploadAs(token, csv([record()]));
    expect(res.status).toBe(403);
    expect((await request(app).get(`${API}/imports`).set(auth(token))).status).toBe(403);
    /* The Viewer holds candidates.view, which opens the masked register list (any of imports.view, candidates.view). */
    expect((await request(app).get(`${API}/students`).set(auth(token))).status).toBe(200);
  });
});
