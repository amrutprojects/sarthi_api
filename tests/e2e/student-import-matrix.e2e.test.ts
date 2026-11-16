/*
 * Student import: a test matrix of what must be accepted and what must be refused, end to end through the API
 * (file checks, every row rule, duplicates, the review and finalise workflow, and the documents ZIP).
 *
 * Set IMPORT_TEST_FILES_DIR to also write each test file there (with a README of the expected result), so the
 * same files can be uploaded by hand in the admin panel's Student Import screen.
 */
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import type { Express } from 'express';
import { AppDataSource } from '../../src/config/database.config';
import { IMPORT_COLUMNS } from '../../src/modules/students/student.constants';
import { Student } from '../../src/database/entities';
import { withVerhoeffDigit } from '../../src/modules/students/aadhaar';
import { API, actorWith, auth, request, resetData, setupTestApp, superAdmin, teardownTestApp } from '../helpers/test-app';
import { buildZip, sampleJpg, samplePdf, samplePng } from '../helpers/zip';

let app: Express;
beforeAll(async () => {
  app = await setupTestApp();
});
beforeEach(resetData);
afterAll(teardownTestApp);

/* ---------- files to keep for manual testing ---------- */
const OUT = process.env.IMPORT_TEST_FILES_DIR;
const readme: string[] = [];
function keep(name: string, data: Buffer, expected: string) {
  if (!OUT) return;
  name = name.replace(/^([A-E])(\d)(?=-)/, '$10$2'); /* A4 → A04, so the files sort in order */
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), data);
  readme.push(`| ${name} | ${expected} |`);
}
afterAll(() => {
  if (!OUT || !readme.length) return;
  fs.writeFileSync(
    path.join(OUT, 'README.md'),
    [
      '# Student import test files',
      '',
      'Upload each file in Admin Panel > Student Import. Data is synthetic (example.invalid emails, generated Aadhaar numbers).',
      'Files ending in .zip are documents ZIPs: upload the CSV with the same number first, then add the ZIP to that batch.',
      '',
      '| File | Expected result |',
      '|---|---|',
      ...readme.sort(),
      '',
    ].join('\n'),
  );
});

/* ---------- builders ---------- */
const HEADER = IMPORT_COLUMNS.map((c) => c.field);
const DOC_COLUMNS = HEADER.filter((h) => h.startsWith('doc_') && !h.endsWith('_barcode'));
let seq = 0;
const nextAadhaar = () => withVerhoeffDigit(`3456789${String(10000 + ++seq).slice(-4)}`);
const letters = (n: number) => n.toString(26).replace(/\d/g, (d) => 'abcdefghij'[+d]);

function record(over: Record<string, string> = {}): Record<string, string> {
  const n = ++seq;
  const v: Record<string, string> = {
    source_record_id: `MX-${n}`,
    first_name: 'Asha',
    last_name: `Patil${letters(n)}`,
    father_name: 'Ramesh Patil',
    mother_name: 'Sunita Patil',
    email: `asha.mx${n}@example.invalid`,
    date_of_birth: '2003-04-12',
    current_address: 'Flat 1, Test Lane, Pune',
    aadhaar_number: nextAadhaar(),
    mobile_number: `97${String(10000000 + n).slice(-8)}`,
    religion: 'हिंदू',
    caste: 'ब्राह्मण',
    course_centre: 'Pune',
    technology: 'Cyber Security',
    education_qualification: 'B.Com',
    approval_status: 'APPROVED',
    approved_at: '2026-01-10T06:30:00Z',
    evidence_ref: `MA-APR-${n}`,
    declaration_accepted: 'Yes',
  };
  for (const f of DOC_COLUMNS) v[f] = 'Yes';
  v.doc_pan_card = 'No';
  v.doc_name_change = 'No';
  v.doc_other = 'No';
  v.doc_income_ews_barcode = `27${String(n).padStart(16, '0')}`;
  v.doc_domicile_barcode = `28${String(n).padStart(16, '0')}`;
  return { ...v, ...over };
}

const csv = (rows: Record<string, string>[], header = HEADER) =>
  Buffer.from(
    '﻿' + [header.join(','), ...rows.map((r) => header.map((h) => `"${(r[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\r\n'),
  );

async function xlsx(rows: Record<string, ExcelJS.CellValue>[], header = HEADER): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Students');
  ws.addRow(header);
  for (const r of rows) ws.addRow(header.map((h) => r[h] ?? ''));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function people() {
  const op = await actorWith(['imports.view', 'imports.create', 'imports.update', 'imports.delete']);
  const rv = await actorWith(['imports.view', 'imports.update', 'imports.approve']);
  return { op: op.token, rv: rv.token };
}
const upload = (token: string, file: Buffer, name = 'students.csv') =>
  request(app).post(`${API}/imports`).set(auth(token)).attach('file', file, name);
const addZip = (token: string, batchId: string, zip: Buffer, name = 'documents.zip') =>
  request(app).post(`${API}/imports/${batchId}/documents`).set(auth(token)).attach('documents', zip, name);
type Row = { id: string; rowNumber: number; status: string; sourceRecordId: string; issues: { field: string; code: string; message: string; status: string }[]; match: { tier: string; note: string } | null };
async function rows(token: string, batchId: string): Promise<Row[]> {
  const res = await request(app).get(`${API}/imports/${batchId}/rows?limit=200`).set(auth(token));
  expect(res.status).toBe(200);
  return res.body.data;
}
const bySrc = (all: Row[], src: string) => {
  const r = all.find((x) => x.sourceRecordId === src);
  if (!r) throw new Error(`row ${src} not found`);
  return r;
};
const codes = (r: Row) => r.issues.filter((i) => i.status === 'OPEN').map((i) => `${i.field}:${i.code}`);
const yearsAgo = (y: number) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - y);
  return d.toISOString().slice(0, 10);
};
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/* ================================================================================================ */
describe('A. whole-file checks', () => {
  it('A1 accepts a valid CSV (UTF-8 with BOM, Marathi values): every row VALID, batch ready to finalise', async () => {
    const { op } = await people();
    const file = csv([record(), record(), record()]);
    keep('A01-valid-3-students.csv', file, 'READY_TO_FINALISE, 3 valid rows');
    const res = await upload(op, file);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'READY_TO_FINALISE', counts: { total: 3, valid: 3, exceptions: 0 } });
  });

  it('A2 accepts a valid XLSX, including a real date cell for the date of birth', async () => {
    const { op } = await people();
    const r = record();
    const file = await xlsx([{ ...r, date_of_birth: new Date(Date.UTC(2003, 3, 12)) }, record()]);
    keep('A02-valid-2-students.xlsx', file, 'READY_TO_FINALISE, 2 valid rows (date of birth typed as an Excel date)');
    const res = await upload(op, file, 'students.xlsx');
    expect(res.body.data).toMatchObject({ status: 'READY_TO_FINALISE', counts: { total: 2, valid: 2 } });
  });

  it('A3 maps headers written as labels or aliases (Aadhar, DOB, Father\'s Name, Remarks …) and lists unknown columns as kept', async () => {
    const { op } = await people();
    const r = record();
    /* "Remarks" is an alias of source_remarks (so it replaces that column here); "Counsellor Notes" is unknown. */
    const header = HEADER.map(
      (h) =>
        (
          ({
            aadhaar_number: 'Aadhar',
            date_of_birth: 'DOB',
            father_name: "Father's Name",
            mobile_number: 'Mobile Number',
            email: 'E-mail',
            source_remarks: 'Remarks',
          }) as Record<string, string>
        )[h] ?? h,
    );
    const renamed = Object.fromEntries(header.map((h, i) => [h, r[HEADER[i]]]));
    const file = csv(
      [{ ...renamed, Remarks: 'y', 'Caste Description': 'x', 'Counsellor Notes': 'z' }],
      [...header, 'Caste Description', 'Counsellor Notes'],
    );
    keep(
      'A03-aliased-headers.csv',
      file,
      'READY_TO_FINALISE; "Remarks" read as the source remarks, "Caste Description" ignored, "Counsellor Notes" kept as an other source value',
    );
    const res = await upload(op, file);
    expect(res.body.data.status).toBe('READY_TO_FINALISE');
    expect(res.body.data.ignoredColumns).toEqual(
      expect.arrayContaining(['Caste Description (not used in V1.0)', 'Counsellor Notes (kept as an other source value)']),
    );
    expect(res.body.data.columnMapping).toMatchObject({ aadhaar_number: 'Aadhar', date_of_birth: 'DOB', source_remarks: 'Remarks' });
    const [row] = await rows(op, res.body.data.id);
    expect(row).toMatchObject({ sourceRemarks: 'y', sourceExtra: { 'Counsellor Notes': 'z' } });
  });

  it.each([
    ['A4 empty file', Buffer.alloc(0), /empty/i],
    ['A5 header row only', Buffer.from(HEADER.join(',') + '\n'), /no data rows/i],
    ['A6 a required column missing', csv([record()], HEADER.filter((h) => h !== 'aadhaar_number')), /Required columns missing: Aadhaar Number/],
    ['A7 two columns for the same field', csv([record()], [...HEADER, 'Aadhar']), /Two columns map to the same field "aadhaar_number"/],
    ['A8 Windows-1252 (not UTF-8) CSV', Buffer.from('source_record_id,first_name\nMX-1,Ren\xe9\n', 'latin1'), /neither an XLSX workbook nor UTF-8/],
    ['A9 UTF-16 "Unicode text" export from Excel', Buffer.from('﻿source_record_id,first_name\r\nMX-1,Asha\r\n', 'utf16le'), /binary data|neither/],
    ['A10 a binary file renamed .csv', samplePng(), /binary data|neither/],
    ['A11 a damaged XLSX', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('not really a workbook')]), /could not be read/],
  ])('%s → IMPORT_FAILED with a clear reason', async (label, file, reason) => {
    const { op } = await people();
    keep(`${label.split(' ')[0]}-${label.slice(label.indexOf(' ') + 1).replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}.${label.includes('XLSX') ? 'xlsx' : 'csv'}`, file, `IMPORT_FAILED: ${reason.source}`);
    const res = await upload(op, file, label.includes('XLSX') ? 'students.xlsx' : 'students.csv');
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('IMPORT_FAILED');
    expect(res.body.data.failureReason).toMatch(reason);
  });

  it('A12 refuses more rows than IMPORT_MAX_ROWS (50,000)', async () => {
    const { op } = await people();
    const file = Buffer.from(['source_record_id', ...Array.from({ length: 50_001 }, (_, i) => `R-${i}`)].join('\n'));
    const res = await upload(op, file);
    expect(res.body.data.status).toBe('IMPORT_FAILED');
    expect(res.body.data.failureReason).toMatch(/50001 rows; the limit is 50000/);
  });

  it('A13 refuses a data file over IMPORT_MAX_FILE_MB (20 MB) before reading it', async () => {
    const { op } = await people();
    const res = await upload(op, Buffer.alloc(21 * 1024 * 1024, 0x20));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/larger than 20 MB/);
  });

  it('A14 requires a file in the "file" field', async () => {
    const { op } = await people();
    const res = await request(app).post(`${API}/imports`).set(auth(op)).field('sourceReference', 'x');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Attach a CSV or XLSX file/);
  });

  it('A15 uploading the same file twice returns the first batch; after cancelling it, the same file makes a new batch', async () => {
    const { op } = await people();
    const file = csv([record()]);
    const first = await upload(op, file);
    const again = await upload(op, file, 'renamed.csv');
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(first.body.data.id);
    expect(again.body.message).toMatch(/already uploaded/);
    expect((await request(app).post(`${API}/imports/${first.body.data.id}/cancel`).set(auth(op))).status).toBe(200);
    const third = await upload(op, file);
    expect(third.status).toBe(201);
    expect(third.body.data.id).not.toBe(first.body.data.id);
  });

  it('A16 empty lines: skipped in CSV and XLSX; but a CSV line of only commas (as Excel exports blank rows) becomes an all-empty exception row', async () => {
    const { op } = await people();
    const [a, b] = [record(), record()];
    const lines = csv([a, b]).toString('utf8').split('\r\n');
    const text = [lines[0], lines[1], '', HEADER.map(() => '').join(','), lines[2]].join('\r\n');
    keep('A16-blank-and-comma-only-lines.csv', Buffer.from(text), '2 valid rows + 1 exception row made from the ",,,,," line (it should be skipped)');
    const res = await upload(op, Buffer.from(text));
    /* Documents current behaviour (a finding): the comma-only line is imported as a row full of REQUIRED issues. */
    expect(res.body.data.counts).toMatchObject({ total: 3, valid: 2, exceptions: 1 });

    const wbFile = await xlsx([a, {}, b].map((r) => ({ ...r, source_record_id: r.source_record_id ? `${r.source_record_id}-X` : '' })));
    const viaXlsx = await upload(op, wbFile, 'students.xlsx');
    expect(viaXlsx.body.data.counts).toMatchObject({ total: 2 });
  });
});

/* ================================================================================================ */
describe('B. row rules (one file, one row per case)', () => {
  const long = (n: number, ch = 'a') => ch.repeat(n);
  const badChecksum = () => {
    const a = nextAadhaar();
    return a.slice(0, 11) + String((Number(a[11]) + 1) % 10);
  };
  /* [case id, overrides, expected open issues ("field:CODE"); [] = must be VALID with no issue] */
  const CASES: [string, Record<string, string>, string[]][] = [
    ['ok-baseline', {}, []],
    ['ok-aadhaar-with-spaces', { aadhaar_number: '' }, []],
    ['ok-mobile-plus91-spaces', { mobile_number: '+91 98765 43210' }, []],
    ['ok-mobile-0-prefix', { mobile_number: '09876543211' }, []],
    ['ok-centre-by-code', { course_centre: 'NAS' }, []],
    ['ok-centre-lowercase', { course_centre: 'pune' }, []],
    ['ok-track-by-code', { technology: 'T03' }, []],
    ['ok-track-by-alias', { technology: 'AI-ML Engineer' }, []],
    ['ok-marathi-names', { first_name: 'आशा', last_name: 'पाटीलक', father_name: 'रमेश पाटील', mother_name: 'सुनीता पाटील' }, []],
    ['ok-name-punctuation', { last_name: "D'Souza-Patilx", father_name: 'R. K. Patil' }, []],
    ['ok-email-uppercase', { email: 'ASHA.UPPER@EXAMPLE.INVALID' }, []],
    ['ok-approval-lowercase-date-only', { approval_status: 'approved', approved_at: '2026-01-10' }, []],
    ['ok-education-other-case', { education_qualification: 'b.com' }, []],
    ['ok-multiline-address', { current_address: 'Flat 1\nTest Lane\nPune' }, []],
    /* Accepted today although the registration form would refuse them (see report). */
    ['gap-age-5-years', { date_of_birth: yearsAgo(5) }, []],
    ['gap-declaration-no', { declaration_accepted: 'No' }, []],
    ['gap-declaration-blank', { declaration_accepted: '' }, []],

    ['src-missing', { source_record_id: '' }, ['source_record_id:SRC_ID_MISSING']],
    ['first-name-missing', { first_name: '' }, ['first_name:REQUIRED']],
    ['first-name-digit', { first_name: 'Asha1' }, ['first_name:NAME_INVALID']],
    ['last-name-too-long', { last_name: long(101) }, ['last_name:TEXT_TOO_LONG']],
    ['father-name-digit', { father_name: 'Ramesh 2' }, ['father_name:NAME_INVALID']],
    ['mother-name-symbol', { mother_name: 'Sunita@Patil' }, ['mother_name:NAME_INVALID']],
    ['email-missing', { email: '' }, ['email:REQUIRED']],
    ['email-invalid', { email: 'asha@nowhere' }, ['email:EMAIL_INVALID']],
    ['dob-missing', { date_of_birth: '' }, ['date_of_birth:REQUIRED']],
    ['dob-dd-mm-yyyy', { date_of_birth: '12/04/2003' }, ['date_of_birth:DOB_INVALID']],
    ['dob-not-a-real-date', { date_of_birth: '2003-02-30' }, ['date_of_birth:DOB_INVALID']],
    ['dob-in-future', { date_of_birth: inDays(30) }, ['date_of_birth:DOB_INVALID']],
    ['address-missing', { current_address: '' }, ['current_address:REQUIRED']],
    ['address-too-long', { current_address: long(501) }, ['current_address:TEXT_TOO_LONG']],
    ['aadhaar-missing', { aadhaar_number: '' }, ['aadhaar_number:REQUIRED']],
    ['aadhaar-11-digits', { aadhaar_number: '23456789012' }, ['aadhaar_number:AADHAAR_INVALID']],
    ['aadhaar-bad-checksum', { aadhaar_number: '' }, ['aadhaar_number:AADHAAR_INVALID']],
    ['aadhaar-starts-with-1', { aadhaar_number: withVerhoeffDigit('12345678901') }, ['aadhaar_number:AADHAAR_INVALID']],
    ['aadhaar-letters', { aadhaar_number: '2345ABCD9012' }, ['aadhaar_number:AADHAAR_INVALID']],
    ['mobile-missing', { mobile_number: '' }, ['mobile_number:REQUIRED']],
    ['mobile-starts-with-5', { mobile_number: '5876543210' }, ['mobile_number:MOBILE_INVALID']],
    ['mobile-9-digits', { mobile_number: '987654321' }, ['mobile_number:MOBILE_INVALID']],
    ['religion-missing', { religion: '' }, ['religion:REQUIRED']],
    ['religion-in-english', { religion: 'Hindu' }, ['religion:REF_UNKNOWN']],
    ['caste-missing', { caste: '' }, ['caste:REQUIRED']],
    ['caste-unknown', { caste: 'Unknown caste' }, ['caste:REF_UNKNOWN']],
    ['centre-missing', { course_centre: '' }, ['course_centre:REQUIRED']],
    ['centre-unknown', { course_centre: 'Atlantis' }, ['course_centre:REF_UNKNOWN']],
    ['track-missing', { technology: '' }, ['technology:REQUIRED']],
    ['track-not-offered', { technology: 'Accounting & Financial Management' }, ['technology:TRACK_NOT_OFFERED']],
    ['track-unknown', { technology: 'Rocket Science' }, ['technology:REF_UNKNOWN']],
    ['education-missing', { education_qualification: '' }, ['education_qualification:REQUIRED']],
    ['education-not-in-master', { education_qualification: 'Diploma in Pottery' }, ['education_qualification:REF_UNKNOWN']],
    /* Still under review at the source: waivable (accepted → added as pending approval). A closed status is never imported. */
    ['approval-pending', { approval_status: 'PENDING' }, ['approval_status:NOT_APPROVED']],
    ['approval-rejected', { approval_status: 'REJECTED' }, ['approval_status:EVIDENCE_MISSING']],
    ['approved-at-missing', { approved_at: '' }, ['approved_at:EVIDENCE_MISSING']],
    ['approved-at-garbage', { approved_at: 'yesterday' }, ['approved_at:EVIDENCE_MISSING']],
    ['approved-at-future', { approved_at: inDays(10) }, ['approved_at:EVIDENCE_MISSING']],
    ['doc-mandatory-no', { doc_photo: 'No' }, ['doc_photo:DOC_MISSING']],
    ['doc-path-other-folder', { doc_photo: 'SOMEONE-ELSE/photo.jpg' }, ['doc_photo:DOC_INVALID']],
    ['doc-path-parent-dir', { doc_photo: '../photo.jpg' }, ['doc_photo:DOC_MISSING']],
    ['ews-barcode-missing', { doc_income_ews_barcode: '' }, ['doc_income_ews_barcode:REQUIRED']],
    ['domicile-barcode-missing', { doc_domicile_barcode: '' }, ['doc_domicile_barcode:REQUIRED']],
    ['ews-barcode-17-digits', { doc_income_ews_barcode: '27123456789012345' }, ['doc_income_ews_barcode:BARCODE_INVALID']],
    ['domicile-barcode-letters', { doc_domicile_barcode: 'DOM12345678901234X' }, ['doc_domicile_barcode:BARCODE_INVALID']],
    ['barcode-with-spaces', { doc_income_ews_barcode: '2712 3456 7890 1234 56' }, ['doc_income_ews_barcode:BARCODE_INVALID']],
    ['several-issues', { email: 'bad', mobile_number: '12', aadhaar_number: '1' }, ['email:EMAIL_INVALID', 'aadhaar_number:AADHAAR_INVALID', 'mobile_number:MOBILE_INVALID']],
  ];

  it('flags exactly the expected issue on each row and leaves valid variants VALID', async () => {
    const { op } = await people();
    const recs = CASES.map(([id, over]) => {
      const r = record({ source_record_id: `B-${id}`.slice(0, 60), ...over });
      if (id === 'src-missing') r.source_record_id = over.source_record_id;
      if (id === 'ok-aadhaar-with-spaces') r.aadhaar_number = nextAadhaar().replace(/(\d{4})(?=\d)/g, '$1 ');
      if (id === 'aadhaar-bad-checksum') r.aadhaar_number = badChecksum();
      return r;
    });
    const file = csv(recs);
    keep(
      'B01-row-rules-one-row-per-case.csv',
      file,
      `VALIDATED_WITH_EXCEPTIONS. One row per case (source_record_id "B-<case>"): rows "B-ok-…" and "B-gap-…" VALID; every other row shows exactly its issue`,
    );
    const res = await upload(op, file);
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('VALIDATED_WITH_EXCEPTIONS');
    const all = await rows(op, res.body.data.id);
    expect(all).toHaveLength(CASES.length);
    const wrong: string[] = [];
    CASES.forEach(([id, , expected], i) => {
      const row = all.find((r) => r.rowNumber === i + 2)!;
      const got = codes(row).sort();
      const want = [...expected].sort();
      const status = want.length ? 'DATA_EXCEPTION' : 'VALID';
      if (JSON.stringify(got) !== JSON.stringify(want) || row.status !== status)
        wrong.push(`${id}: expected ${status} ${JSON.stringify(want)}, got ${row.status} ${JSON.stringify(got)}`);
    });
    expect(wrong).toEqual([]);
    /* The Aadhaar number never appears in an issue message. */
    expect(JSON.stringify(all.flatMap((r) => r.issues.map((i) => i.message)))).not.toMatch(/\d{12}/);
  });

  it('BUG: a source record ID longer than 64 characters crashes the whole upload (500) instead of flagging that row', async () => {
    const { op } = await people();
    const file = csv([record(), record({ source_record_id: 'S' + long(64, '1') })]);
    keep('B03-source-id-65-characters.csv', file, 'Should be: row 3 TEXT_TOO_LONG, row 2 VALID. Today: the upload fails with a server error (500)');
    const res = await upload(op, file);
    /* Documents current behaviour (a bug): the validator flags TEXT_TOO_LONG but the 65 characters are still written to a varchar(64). */
    expect(res.status).toBe(500);
  });

  it('XLSX: an 18-digit barcode typed as a NUMBER loses its last digits in Excel, yet still passes the 18-digit check', async () => {
    const { op } = await people();
    /* Excel keeps 15 significant digits: 271234567890123456 is stored as 271234567890123000. */
    const file = await xlsx([{ ...record({ source_record_id: 'XL-NUM' }), doc_income_ews_barcode: 271234567890123000 }]);
    keep('B02-xlsx-barcode-typed-as-number.xlsx', file, 'Should be refused (the barcode lost digits in Excel) but is accepted as VALID today');
    const res = await upload(op, file, 'students.xlsx');
    const [row] = await rows(op, res.body.data.id);
    /* Documents current behaviour (a finding): the corrupted value is accepted. */
    expect(row.status).toBe('VALID');
  });
});

/* ================================================================================================ */
describe('C. duplicates', () => {
  it('C1 inside one file: same source ID, or same Aadhaar under another ID, is DUPLICATE_IN_FILE (not waivable)', async () => {
    const { op } = await people();
    const a = record({ source_record_id: 'DUP-1' });
    const sameId = record({ source_record_id: 'DUP-1' });
    const sameAadhaar = record({ source_record_id: 'DUP-2', aadhaar_number: a.aadhaar_number });
    const file = csv([a, sameId, sameAadhaar]);
    keep('C01-duplicates-inside-file.csv', file, 'Row 2 VALID; rows 3 (same source ID) and 4 (same Aadhaar) DUPLICATE_IN_FILE');
    const res = await upload(op, file);
    const all = await rows(op, res.body.data.id);
    expect(codes(all[0])).toEqual([]);
    expect(codes(all[1])).toEqual(['source_record_id:DUPLICATE_IN_FILE']);
    expect(codes(all[2])).toEqual(['aadhaar_number:DUPLICATE_IN_FILE']);
    const accept = await request(app).post(`${API}/imports/${res.body.data.id}/rows/${all[1].id}/accept`).set(auth(op)).send({ reason: 'same person' });
    expect(accept.status).toBe(400);
  });

  it('C2 against students already imported: unchanged → skipped; T0 / T1 / T1-conflict / T2 need a decision; T3 is only a note', async () => {
    const { op, rv } = await people();
    const s = [record(), record(), record(), record(), record()];
    keep('C02a-first-import-5-students.csv', csv(s), 'READY_TO_FINALISE; finalise it (as a second user) before uploading C02b');
    const first = await upload(op, csv(s));
    expect((await request(app).post(`${API}/imports/${first.body.data.id}/finalise`).set(auth(rv)).send({ confirmCode: first.body.data.code })).status).toBe(200);

    const unchanged = s[0];
    const changed = { ...s[1], email: 'changed.mx@example.invalid' };
    const sameAadhaar = record({ aadhaar_number: s[2].aadhaar_number, first_name: s[2].first_name, last_name: s[2].last_name, date_of_birth: s[2].date_of_birth });
    const aadhaarConflict = record({ aadhaar_number: s[3].aadhaar_number, first_name: 'Kavita' });
    const sameNameDobMobile = record({ first_name: s[4].first_name, last_name: s[4].last_name, date_of_birth: s[4].date_of_birth, mobile_number: s[4].mobile_number });
    const sharesMobile = record({ mobile_number: s[0].mobile_number });
    const second = await upload(op, csv([unchanged, changed, sameAadhaar, aadhaarConflict, sameNameDobMobile, sharesMobile]));
    keep(
      'C02b-second-import-against-register.csv',
      csv([unchanged, changed, sameAadhaar, aadhaarConflict, sameNameDobMobile, sharesMobile]),
      'After C02a is finalised: row 2 SKIPPED_UNCHANGED; rows 3–6 POSSIBLE_DUPLICATE (T0, T1, T1 CONFLICT, T2); row 7 VALID with a T3 note',
    );
    const all = await rows(op, second.body.data.id);
    const at = (i: number) => all.find((r) => r.rowNumber === i + 2)!;
    expect(at(0)).toMatchObject({ status: 'SKIPPED_UNCHANGED', match: { tier: 'T0' } });
    expect(at(1)).toMatchObject({ status: 'POSSIBLE_DUPLICATE', match: { tier: 'T0' } });
    expect(at(2)).toMatchObject({ status: 'POSSIBLE_DUPLICATE', match: { tier: 'T1' } });
    expect(at(3).match?.note).toMatch(/CONFLICT/);
    expect(at(4)).toMatchObject({ status: 'POSSIBLE_DUPLICATE', match: { tier: 'T2' } });
    expect(at(5)).toMatchObject({ status: 'VALID', match: { tier: 'T3' } });

    /* Decisions: HOLD keeps the batch blocked; SAME_PERSON links, DIFFERENT_PERSON creates. */
    const decide = (r: Row, decision: string) =>
      request(app).post(`${API}/imports/${second.body.data.id}/rows/${r.id}/decide`).set(auth(op)).send({ decision, reason: 'checked documents' });
    await decide(at(1), 'SAME_PERSON');
    await decide(at(2), 'SAME_PERSON');
    await decide(at(3), 'DIFFERENT_PERSON');
    await decide(at(4), 'HOLD');
    const blocked = await request(app).post(`${API}/imports/${second.body.data.id}/finalise`).set(auth(rv)).send({ confirmCode: second.body.data.code });
    expect(blocked.status).toBe(409);
    await decide(at(4), 'SAME_PERSON');
    const done = await request(app).post(`${API}/imports/${second.body.data.id}/finalise`).set(auth(rv)).send({ confirmCode: second.body.data.code });
    expect(done.status).toBe(200);
    expect(done.body.data.counts).toMatchObject({ linked: 3, created: 2 });
    expect(await AppDataSource.getRepository(Student).count()).toBe(7);
  });
});

/* ================================================================================================ */
describe('D. review and finalise workflow', () => {
  it('waivable vs non-waivable issues, reject / restore, four-eyes finalise with the batch code, and nothing changes afterwards', async () => {
    const { op, rv } = await people();
    const ok = record({ source_record_id: 'WF-OK' });
    const waivable = record({ source_record_id: 'WF-CASTE', caste: 'Unknown caste' });
    const hard = record({ source_record_id: 'WF-EMAIL', email: 'broken' });
    const file = csv([ok, waivable, hard]);
    keep('D01-workflow-waivable-and-hard-issues.csv', file, 'WF-CASTE can be accepted with a reason; WF-EMAIL cannot (reject it); then a second person finalises');
    const up = await upload(op, file);
    const id = up.body.data.id;
    let all = await rows(op, id);
    const w = bySrc(all, 'WF-CASTE');
    const h = bySrc(all, 'WF-EMAIL');
    const post = (url: string, body: object, token = op) => request(app).post(`${API}/imports/${id}${url}`).set(auth(token)).send(body);

    expect((await post(`/rows/${h.id}/accept`, { reason: 'looks fine' })).status).toBe(400); /* not waivable */
    expect((await post(`/rows/${w.id}/accept`, { reason: 'ok' })).status).toBe(422); /* reason too short */
    expect((await post(`/rows/${w.id}/accept`, { reason: 'caste confirmed by phone' })).status).toBe(200);
    expect((await post('/finalise', { confirmCode: up.body.data.code }, rv)).status).toBe(409); /* WF-EMAIL still open */

    expect((await post(`/rows/${h.id}/reject`, { reason: 'email must be corrected at source' })).status).toBe(200);
    expect((await post(`/rows/${h.id}/restore`, {})).body.data.status).toBe('DATA_EXCEPTION');
    expect((await post(`/rows/${h.id}/reject`, { reason: 'email must be corrected at source' })).status).toBe(200);
    all = await rows(op, id);
    expect(bySrc(all, 'WF-CASTE').status).toBe('VALID');

    /* Four eyes: the uploader may not finalise, even with the permission. */
    const admin = await superAdmin();
    const own = await upload(admin.token, csv([record()]));
    const selfFinalise = await request(app).post(`${API}/imports/${own.body.data.id}/finalise`).set(auth(admin.token)).send({ confirmCode: own.body.data.code });
    expect(selfFinalise.status).toBe(403);

    expect((await post('/finalise', { confirmCode: 'IMP-999999' }, rv)).status).toBe(400); /* wrong code */
    const done = await post('/finalise', { confirmCode: up.body.data.code.toLowerCase() }, rv);
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ status: 'FINALISED', counts: { created: 2 } });
    const students = await AppDataSource.getRepository(Student).find();
    expect(students).toHaveLength(2);
    expect(students.every((s) => /^\d+$/.test(String(s.registrationNumber)) && s.aadhaarEnc && s.aadhaarLast4)).toBe(true);

    expect((await post('/finalise', { confirmCode: up.body.data.code }, rv)).status).toBe(409);
    expect((await post(`/rows/${w.id}/reject`, { reason: 'too late now' })).status).toBe(409);
    expect((await post('/cancel', {})).status).toBe(409);
  });

  it('permissions: view-only cannot upload; the operator cannot finalise', async () => {
    const viewer = await actorWith(['imports.view']);
    expect((await upload(viewer.token, csv([record()]))).status).toBe(403);
    const { op } = await people();
    const up = await upload(op, csv([record()]));
    const res = await request(app).post(`${API}/imports/${up.body.data.id}/finalise`).set(auth(op)).send({ confirmCode: up.body.data.code });
    expect(res.status).toBe(403);
  });
});

/* ================================================================================================ */
describe('E. documents ZIP', () => {
  it('matches files by the Excel path and by folder convention, checks every file, reports what it could not use', async () => {
    const { op, rv } = await people();
    const r1 = record({ source_record_id: 'ZIP-1', doc_photo: 'ZIP-1/photo.jpg', doc_signature: 'No', doc_aadhaar_card: 'aadhaar.pdf' });
    const r2 = record({ source_record_id: 'ZIP-2', doc_photo: 'ZIP-2/photo.pdf', doc_signature: 'ZIP-2/sign.png', doc_school_leaving: 'ZIP-2/lc.pdf' });
    const data = csv([r1, r2]);
    const zip = await buildZip({
      'ZIP-1/photo.jpg': sampleJpg(), // named in the Excel → matched by path
      'ZIP-1/SIGNATURE.png': samplePng(), // folder convention
      'ZIP-1/random-scan.pdf': samplePdf(), // unknown document type
      'readme.txt': 'top-level file', // no student folder
      'UNKNOWN-9/PHOTO.jpg': sampleJpg(), // no such student
      'ZIP-2/photo.pdf': samplePng(), // PNG content with a .pdf name
      'ZIP-2/sign.png': Buffer.from('MZ\x90\x00 pretend executable'), // not a PDF/JPG/PNG
      'ZIP-2/lc.pdf': Buffer.concat([samplePdf(), Buffer.alloc(6 * 1024 * 1024, 0x20)]), // over 5 MB
    });
    keep('E01-documents-students.csv', data, 'Upload first; ZIP-1 and ZIP-2 wait for documents');
    keep('E01-documents.zip', zip, 'Add to the E01 batch: ZIP-1 photo + signature stored, aadhaar.pdf reported missing; ZIP-2 photo, signature and LC refused');
    const up = await upload(op, data);
    const res = await addZip(op, up.body.data.id, zip);
    expect(res.status).toBe(200);
    const rep = res.body.data.documentsReport;
    /* matchedByPath counts every file the Excel named, including the three that are then refused. */
    expect(rep).toMatchObject({ matchedByPath: 4, unmatchedFolders: ['UNKNOWN-9'] });
    expect(rep.stored).toBe(2);
    expect(rep.rejected.map((x: { path: string }) => x.path)).toEqual(expect.arrayContaining(['readme.txt', 'ZIP-1/random-scan.pdf']));
    expect(rep.missingReferenced).toEqual([expect.objectContaining({ sourceRecordId: 'ZIP-1', docType: 'AADHAAR_CARD' })]);

    const all = await rows(op, up.body.data.id);
    const one = bySrc(all, 'ZIP-1');
    expect(codes(one)).toEqual(['doc_aadhaar_card:DOC_MISSING']);
    expect(one.issues.find((i) => i.code === 'DOC_MISSING')!.message).toMatch(/was not found in documents\.zip/);
    const two = codes(bySrc(all, 'ZIP-2'));
    expect(two).toEqual(expect.arrayContaining(['doc_photo:DOC_INVALID', 'doc_signature:DOC_INVALID', 'doc_school_leaving:DOC_INVALID']));
    const msgs = bySrc(all, 'ZIP-2').issues.map((i) => i.message).join(' | ');
    expect(msgs).toMatch(/content is PNG/);
    expect(msgs).toMatch(/not a PDF, JPG or PNG/);
    expect(msgs).toMatch(/larger than 5 MB/);

    /* Fixing the missing file with a second ZIP clears the issue; after finalising, ZIPs are refused and files belong to the student. */
    const fix = await addZip(op, up.body.data.id, await buildZip({ 'ZIP-1/aadhaar.pdf': samplePdf() }), 'fix.zip');
    expect(fix.status).toBe(200);
    expect(codes(bySrc(await rows(op, up.body.data.id), 'ZIP-1'))).toEqual([]);
    await request(app).post(`${API}/imports/${up.body.data.id}/rows/${bySrc(all, 'ZIP-2').id}/reject`).set(auth(op)).send({ reason: 'documents unreadable' });
    const done = await request(app).post(`${API}/imports/${up.body.data.id}/finalise`).set(auth(rv)).send({ confirmCode: up.body.data.code });
    expect(done.status).toBe(200);
    const [{ n }] = await AppDataSource.query(`SELECT count(*)::int AS n FROM "student_documents" WHERE "studentId" IS NOT NULL AND "isDelete" = false`);
    expect(n).toBe(3);
    expect((await addZip(op, up.body.data.id, await buildZip({ 'ZIP-1/PHOTO.jpg': sampleJpg() }))).status).toBe(409);
  });

  it.each([
    [
      'zip-slip path',
      /* yazl refuses to write "../": write "aa/evil.pdf" and rename it in the archive bytes (same length; the CRC covers only the data). */
      async () => {
        const z = await buildZip({ 'aa/evil.pdf': samplePdf() });
        return Buffer.from(z.toString('latin1').split('aa/evil.pdf').join('../evil.pdf'), 'latin1');
      },
      /* Refused by the ZIP library (yauzl) before the app's own "Unsafe path" check: either way, a 400. */
      /Unsafe path|invalid relative path/,
    ],
    ['not a ZIP at all', async () => samplePdf(), /not a valid ZIP/],
  ])('refuses a documents file with a %s', async (_label, make, message) => {
    const { op } = await people();
    const up = await upload(op, csv([record()]));
    const res = await addZip(op, up.body.data.id, await make());
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(message);
  });
});
