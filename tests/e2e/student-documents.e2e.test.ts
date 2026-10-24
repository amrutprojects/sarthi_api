import fs from 'fs';
import path from 'path';
import type { Express } from 'express';
import { IMPORT_COLUMNS } from '../../src/modules/students/student.constants';
import { storageRoot } from '../../src/modules/students/documents/document-storage';
import { withVerhoeffDigit } from '../../src/modules/students/aadhaar';
import { API, auth, createUser, login, request, resetData, setupTestApp, teardownTestApp } from '../helpers/test-app';
import { buildZip, sampleJpg, samplePdf } from '../helpers/zip';

/*
 * Student import with a documents ZIP: data file + ZIP → files staged per student → finalise moves them to
 * storage/students/<STU-code>/ → downloadable from the register.
 */
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

const HEADER = IMPORT_COLUMNS.map((c) => c.field);
let seq = 0;
function record(sourceId: string, over: Record<string, string> = {}): Record<string, string> {
  const n = ++seq;
  const letters = n.toString(26).replace(/\d/g, (d) => 'abcdefghij'[+d]);
  const v: Record<string, string> = {
    source_record_id: sourceId,
    first_name: 'Asha',
    last_name: `Doc${letters}`,
    father_name: 'Ramesh',
    mother_name: 'Sunita',
    email: `doc${n}@example.invalid`,
    date_of_birth: '2003-04-12',
    current_address: 'Flat 0, Test Lane',
    aadhaar_number: withVerhoeffDigit(`3456789${String(10000 + n).slice(-4)}`),
    mobile_number: `97${String(10000000 + n).slice(-8)}`,
    religion: 'हिंदू',
    caste: 'मराठी',
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
const csv = (rows: Record<string, string>[]) =>
  Buffer.from([HEADER.join(','), ...rows.map((r) => HEADER.map((h) => `"${(r[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n'));

async function people() {
  const op = await createUser({ roleCodes: ['IMPORT_OPERATOR'] });
  const rv = await createUser({ roleCodes: ['IMPORT_REVIEWER'] });
  return { op: await login(op.email), rv: await login(rv.email) };
}
const exists = (rel: string) => fs.existsSync(path.join(storageRoot(), ...rel.split('/')));

describe('student import with a documents ZIP', () => {
  it('stores documents per student, clears missing-document issues, and moves them to the student folder on finalise', async () => {
    const { op, rv } = await people();
    /* Row A says its photo is missing in the sheet; the ZIP supplies it. Row B gets an Aadhaar card. */
    const rows = [record('MA-DOC-A', { doc_photo: 'No' }), record('MA-DOC-B')];
    const photo = sampleJpg();
    const zip = await buildZip({
      'MA-DOC-A/PHOTO.jpg': photo,
      'MA-DOC-A/AADHAAR_CARD.pdf': samplePdf('A'),
      'MA-DOC-B/aadhaar card.pdf': samplePdf('B'),
      'MA-DOC-B/PHOTO.pdf': Buffer.from('MZ not a pdf'),
      'MA-UNKNOWN/PHOTO.jpg': sampleJpg(),
      'MA-DOC-A/holiday.jpg': sampleJpg(),
    });

    const up = await request(app)
      .post(`${API}/imports`)
      .set(auth(op))
      .attach('file', csv(rows), 'students.csv')
      .attach('documents', zip, 'docs.zip');
    expect(up.status).toBe(201);
    const batch = up.body.data;
    expect(batch.documentsReport).toMatchObject({ stored: 3, studentsWithFiles: 2, unmatchedFolders: ['MA-UNKNOWN'] });
    expect(batch.documentsReport.rejected.map((r: { path: string }) => r.path).sort()).toEqual([
      'MA-DOC-A/holiday.jpg',
      'MA-DOC-B/PHOTO.pdf',
    ]);
    expect(exists(`imports/${batch.code}/MA-DOC-A/PHOTO.jpg`)).toBe(true);

    /* Row A: the photo arrived, so no DOC_MISSING. Row B: the invalid photo file is a DOC_INVALID issue. */
    const list = (await request(app).get(`${API}/imports/${batch.id}/rows`).set(auth(op))).body.data;
    const rowA = list.find((r: { sourceRecordId: string }) => r.sourceRecordId === 'MA-DOC-A');
    const rowB = list.find((r: { sourceRecordId: string }) => r.sourceRecordId === 'MA-DOC-B');
    expect(rowA.issues.filter((i: { status: string }) => i.status === 'OPEN')).toEqual([]);
    expect(rowA.status).toBe('VALID');
    expect(rowB.issues.map((i: { code: string }) => i.code)).toContain('DOC_INVALID');

    /* Reviewers can open a staged file before finalising. */
    const staged = (await request(app).get(`${API}/imports/${batch.id}/rows/${rowA.id}/documents`).set(auth(rv))).body.data;
    expect(staged.map((d: { docType: string }) => d.docType).sort()).toEqual(['AADHAAR_CARD', 'PHOTO']);

    /* Fix B by uploading a correct photo in a second ZIP (replaces nothing on A). */
    const fix = await request(app)
      .post(`${API}/imports/${batch.id}/documents`)
      .set(auth(op))
      .attach('documents', await buildZip({ 'MA-DOC-B/PHOTO.jpg': sampleJpg() }), 'fix.zip');
    expect(fix.status).toBe(200);
    expect(fix.body.data.status).toBe('READY_TO_FINALISE');

    const fin = await request(app).post(`${API}/imports/${batch.id}/finalise`).set(auth(rv)).send({ confirmCode: batch.code });
    expect(fin.status).toBe(200);
    expect(exists(`imports/${batch.code}`)).toBe(false); // staging cleared

    const students = (await request(app).get(`${API}/students`).set(auth(op))).body.data as {
      id: string;
      code: string;
      sourceRecordId: string;
    }[];
    const a = students.find((s) => s.sourceRecordId === 'MA-DOC-A')!;
    expect(exists(`students/${a.code}/PHOTO.jpg`)).toBe(true);
    expect(exists(`students/${a.code}/AADHAAR_CARD.pdf`)).toBe(true);

    const docs = (await request(app).get(`${API}/students/${a.id}/documents`).set(auth(op))).body.data;
    const photoDoc = docs.find((d: { docType: string }) => d.docType === 'PHOTO');
    const dl = await request(app)
      .get(`${API}/students/${a.id}/documents/${photoDoc.id}/file`)
      .set(auth(op))
      .buffer(true)
      .parse((res, cb) => {
        const c: Buffer[] = [];
        res.on('data', (x: Buffer) => c.push(x));
        res.on('end', () => cb(null, Buffer.concat(c)));
      });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('image/jpeg');
    expect(dl.headers['content-disposition']).toMatch(/attachment; filename="PHOTO.jpg"/);
    expect(Buffer.compare(dl.body as Buffer, photo)).toBe(0);
  });

  it("accepts only files in each student's folder; Excel cells may name the file, other folders are refused", async () => {
    const { op } = await people();
    const rows = [
      /* A file name is looked up in the student's own folder; "<id>/file" works too (any case). */
      record('MA-PATH-1', { doc_photo: 'Front Photo.JPG', doc_aadhaar_card: 'ma-path-1/kavya-aadhaar.pdf' }),
      /* A path into another folder is refused for that row; a referenced file absent from the ZIP is reported. */
      record('MA-PATH-2', { doc_photo: 'scans/rohan.jpg', doc_caste_cert: 'not-in-zip.pdf' }),
    ];
    const zip = await buildZip({
      'docs/MA-PATH-1/front photo.jpg': sampleJpg(), // one wrapping folder is fine
      'docs/MA-PATH-1/kavya-aadhaar.pdf': samplePdf('aadhaar'),
      'scans/rohan.jpg': sampleJpg(), // not a student folder
      'MA-PATH-2_PHOTO.jpg': sampleJpg(), // flat name: not accepted
    });
    const up = await request(app)
      .post(`${API}/imports`)
      .set(auth(op))
      .attach('file', csv(rows), 'paths.csv')
      .attach('documents', zip, 'paths.zip');
    expect(up.status).toBe(201);
    const report = up.body.data.documentsReport;
    expect(report).toMatchObject({ stored: 2, matchedByPath: 2 });
    expect(report.missingReferenced).toEqual([
      { rowNumber: 3, sourceRecordId: 'MA-PATH-2', docType: 'CASTE_CERT', path: 'MA-PATH-2/not-in-zip.pdf' },
    ]);
    expect(report.unmatchedFolders).toEqual(['scans']);
    expect(report.rejected.map((r: { path: string }) => r.path)).toEqual(['MA-PATH-2_PHOTO.jpg']);

    const list = (await request(app).get(`${API}/imports/${up.body.data.id}/rows`).set(auth(op))).body.data;
    const one = list.find((r: { sourceRecordId: string }) => r.sourceRecordId === 'MA-PATH-1');
    const two = list.find((r: { sourceRecordId: string }) => r.sourceRecordId === 'MA-PATH-2');
    expect(one.status).toBe('VALID');
    const photoIssue = two.issues.find((i: { field: string; code: string }) => i.field === 'doc_photo' && i.code === 'DOC_INVALID');
    expect(photoIssue.message).toMatch(/must be a file in the student's folder MA-PATH-2\//);

    expect(exists(`imports/${up.body.data.code}/MA-PATH-1/PHOTO.jpg`)).toBe(true);
    const docs = (await request(app).get(`${API}/imports/${up.body.data.id}/rows/${one.id}/documents`).set(auth(op))).body.data;
    expect(docs.map((d: { docType: string; sourcePath: string }) => [d.docType, d.sourcePath]).sort()).toEqual([
      ['AADHAAR_CARD', 'docs/MA-PATH-1/kavya-aadhaar.pdf'],
      ['PHOTO', 'docs/MA-PATH-1/front photo.jpg'],
    ]);
  });

  it('rejects a non-ZIP documents file, and documents need imports permissions', async () => {
    const { op } = await people();
    const up = await request(app)
      .post(`${API}/imports`)
      .set(auth(op))
      .attach('file', csv([record('MA-DOC-C')]), 'one.csv');
    const bad = await request(app)
      .post(`${API}/imports/${up.body.data.id}/documents`)
      .set(auth(op))
      .attach('documents', Buffer.from('not a zip'), 'docs.zip');
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/not a valid ZIP/);

    const viewer = await login((await createUser({ roleCodes: ['VIEWER'] })).email);
    expect(
      (
        await request(app)
          .post(`${API}/imports/${up.body.data.id}/documents`)
          .set(auth(viewer))
          .attach('documents', Buffer.from('x'), 'a.zip')
      ).status,
    ).toBe(403);
  });

  it('removes staged documents when a batch is cancelled', async () => {
    const { op } = await people();
    const up = await request(app)
      .post(`${API}/imports`)
      .set(auth(op))
      .attach('file', csv([record('MA-DOC-D')]), 'cancel.csv')
      .attach('documents', await buildZip({ 'MA-DOC-D/PHOTO.jpg': sampleJpg() }), 'd.zip');
    expect(exists(`imports/${up.body.data.code}/MA-DOC-D/PHOTO.jpg`)).toBe(true);
    await request(app).post(`${API}/imports/${up.body.data.id}/cancel`).set(auth(op));
    expect(exists(`imports/${up.body.data.code}`)).toBe(false);
  });
});
