/*
 * Student import of the source portal's "approver dashboard" CSV export, as it is downloaded: header matching,
 * required column groups, other columns kept (identity-number columns never), and the row rules of that layout
 * (name split, primary mobile, district → course centre, religion spelling, approval status, profile columns).
 *
 * APPROVER_HEADER (tests/helpers/approver-export.ts) is the export's header row exactly as written (40 columns). Every
 * value is synthetic: example.invalid emails, 90000000xx mobiles, generated Aadhaar numbers.
 */
import crypto from 'crypto';
import ExcelJS from 'exceljs';
import { buildMasterLookup } from '../../../src/modules/masters';
import { CASTES, CENTRES, DOCUMENTS, IMPORT_COLUMNS } from '../../../src/modules/students/student.constants';
import { headerKey, ImportFileError, parseImportFile } from '../../../src/modules/students/import/file-parser';
import { buildGeographyLookup } from '../../../src/modules/students/import/geography';
import { parseScore, parseSourceTimestamp, validateRow } from '../../../src/modules/students/import/row-validator';
import { withVerhoeffDigit } from '../../../src/modules/students/aadhaar';
import {
  APPROVER_AADHAAR as AADHAAR,
  APPROVER_HEADER,
  APPROVER_MAPPING as EXPECTED_MAPPING,
  approverCsv,
  approverRow,
  BOM,
} from '../../helpers/approver-export';

/* Masters as the migration seeds them, plus the education the export writes ("HSC"). */
const id = () => crypto.randomUUID();
const masters = buildMasterLookup({
  region: CENTRES.map((c) => ({ id: id(), code: c.code, name: c.name })),
  caste: CASTES.map((name, i) => ({ id: id(), code: `C${String(i + 1).padStart(2, '0')}`, name })),
  education: ['HSC', 'Graduate'].map((name, i) => ({ id: id(), code: `E${i + 1}`, name })),
  documentType: DOCUMENTS.map((d) => ({ id: id(), code: d.key, name: d.label, isMandatory: d.required })),
});
/* Geography masters (CMS districts / talukas) in English, as the CMS holds them; the export writes Marathi. */
const PUNE = { id: id(), code: 'PUN', name: 'Pune' };
const NASHIK = { id: id(), code: 'NAS', name: 'Nashik' };
const HAVELI = { id: id(), code: 'HAV', name: 'Haveli', districtId: PUNE.id };
const geography = buildGeographyLookup([PUNE, NASHIK], [HAVELI]);

/* Parses an export with the real parser and validates its rows as the import service does. */
async function importRows(rows: Record<string, string>[], header = APPROVER_HEADER) {
  const parsed = await parseImportFile(approverCsv(rows, header), 100);
  return parsed.rows.map((raw, i) => validateRow(raw, masters, { geography, extra: parsed.extras[i], mapping: parsed.mapping }));
}
async function importOne(over: Record<string, string> = {}) {
  const [r] = await importRows([approverRow(over)]);
  return r;
}
const notDocs = (issues: { field: string; code: string }[]) =>
  issues.filter((i) => i.code !== 'DOC_MISSING').map((i) => `${i.field}:${i.code}`);

describe('headerKey', () => {
  it('ignores case, spaces, underscores, punctuation and a byte-order mark', () => {
    const one = ['applicationId', 'Application ID', 'application_id', 'APPLICATION-ID', ' application id ', `${BOM}applicationId`];
    expect(new Set(one.map(headerKey))).toEqual(new Set(['applicationid']));
    expect(headerKey("Father's Name")).toBe(headerKey('FATHERS_NAME'));
    expect(headerKey('Are you a disabled person ?')).toBe('areyouadisabledperson');
    expect(headerKey('Percentage /  CGPA')).toBe(headerKey('percentage/cgpa'));
    expect(headerKey('Research &amp; Development')).toBe(headerKey('Research & Development'));
  });

  it('keeps letters with their marks (Marathi headers) and digits', () => {
    /* जिल्हा contains a vowel sign and a virama (combining marks): neither is dropped. */
    expect(headerKey(' जिल्हा ')).toBe('जिल्हा'.normalize('NFC'));
    expect(headerKey('जिल्हा')).toHaveLength('जिल्हा'.normalize('NFC').length);
    expect(headerKey('Address Line 2')).toBe('addressline2');
  });
});

describe('approver dashboard export: columns', () => {
  it('maps every one of the 40 columns to a field, ignores none, keeps no extras', async () => {
    const parsed = await parseImportFile(approverCsv([approverRow()]), 100);
    expect(parsed.mapping).toEqual(EXPECTED_MAPPING);
    expect(Object.keys(parsed.mapping)).toHaveLength(40);
    expect(parsed.ignoredColumns).toEqual([]);
    expect(parsed.extras).toEqual([{}]);
    /* Every mapped field is a known import column. */
    const known = new Set(IMPORT_COLUMNS.map((c) => c.field));
    expect(Object.keys(parsed.mapping).filter((f) => !known.has(f))).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({ source_record_id: 'KL400-900001', score: '8', approval_status: 'PENDING' });
  });

  it('names every missing required column group', async () => {
    const without = ['Full Name', 'applicantName', 'Primary Mobile Number', 'Mobile Number', 'District', 'Distrct'];
    const header = APPROVER_HEADER.filter((h) => !without.includes(h));
    const err = await parseImportFile(approverCsv([approverRow()], header), 100).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImportFileError);
    expect((err as Error).message).toBe(
      'Required columns missing: First Name and Last Name (or Full Name), Mobile Number (or Primary Mobile Number), Course Centre (or District)',
    );
  });

  it('a first name without a last name column does not satisfy the name group; Applicant name alone does', async () => {
    const noFull = APPROVER_HEADER.filter((h) => h !== 'Full Name' && h !== 'applicantName');
    await expect(parseImportFile(approverCsv([approverRow()], [...noFull, 'First Name']), 100)).rejects.toThrow(
      /Required columns missing: First Name and Last Name \(or Full Name\)$/,
    );
    const applicantOnly = APPROVER_HEADER.filter((h) => h !== 'Full Name');
    const parsed = await parseImportFile(approverCsv([approverRow()], applicantOnly), 100);
    expect(parsed.mapping.applicant_name).toBe('applicantName');
  });

  it('keeps other columns per row by their header; never stores an identity-number column; lists every unread column', async () => {
    const header = [...APPROVER_HEADER, 'Hostel Required', 'Aadhar No.', 'Caste Description', 'Hostel Required', 'Empty Column'];
    const secret = withVerhoeffDigit('34567890123');
    /* csv() looks values up by header, so the repeated column gets the same value: it is listed, not kept twice. */
    const row = approverRow({ 'Hostel Required': 'Yes', 'Aadhar No.': secret, 'Caste Description': 'x', 'Empty Column': '' });
    const parsed = await parseImportFile(approverCsv([row], header), 100);
    expect(parsed.ignoredColumns).toEqual([
      'Hostel Required (kept as an other source value)',
      'Aadhar No. (identity number: not stored)',
      'Caste Description (not used in V1.0)',
      'Hostel Required (repeated column)',
      'Empty Column (kept as an other source value)',
    ]);
    /* Empty values are not kept. */
    expect(parsed.extras).toEqual([{ 'Hostel Required': 'Yes' }]);
    expect(JSON.stringify({ rows: parsed.rows, extras: parsed.extras })).not.toContain(secret);

    const { row: n } = validateRow(parsed.rows[0], masters, { geography, extra: parsed.extras[0], mapping: parsed.mapping });
    expect(n.sourceExtra).toEqual({ 'Hostel Required': 'Yes' });
    expect(JSON.stringify({ ...n, aadhaarEnc: undefined })).not.toContain(secret);
  });
});

describe('approver dashboard export: row rules', () => {
  it('reads a pending application into the student fields and profile, raising only NOT_APPROVED (and missing documents)', async () => {
    const { row, issues } = await importOne();
    expect(notDocs(issues)).toEqual(['approval_status:NOT_APPROVED']);
    expect(issues.find((i) => i.code === 'NOT_APPROVED')!.message).toMatch(/PENDING, not APPROVED.*until an approved record of KL400-900001/);
    /* No document column in the export: each mandatory document type is missing until the ZIP supplies it. */
    expect(issues.filter((i) => i.code === 'DOC_MISSING').map((i) => i.field).sort()).toEqual(
      DOCUMENTS.filter((d) => d.required)
        .map((d) => `doc_${d.key.toLowerCase()}`)
        .sort(),
    );
    expect(row).toMatchObject({
      sourceRecordId: 'KL400-900001',
      nameFrom: 'full_name',
      firstName: 'Asha Ramesh',
      lastName: 'Patil',
      fatherName: 'Ramesh Patil',
      motherName: 'Sunita Patil',
      email: 'asha.approver@example.invalid',
      dateOfBirth: '2003-04-12',
      currentAddress: 'Flat 1, Test Lane, Pune',
      mobile: '+919000000011',
      aadhaarLast4: AADHAAR.slice(-4),
      religion: 'हिंदू',
      caste: 'ब्राह्मण',
      centreCode: 'PUN',
      centreFromDistrict: true,
      regionId: masters.find('region', 'PUN')!.id,
      casteId: masters.find('caste', 'ब्राह्मण')!.id,
      trackCode: 'T03',
      trackSourceValue: 'Web Design & Development',
      educationQualification: 'HSC',
      educationId: masters.find('education', 'HSC')!.id,
      approvalStatus: 'PENDING',
      approvedAt: null,
      gender: 'Female',
      maritalStatus: 'Unmarried',
      permanentAddress: 'House 2, Sample Road, Pune',
      landmark: 'Near Test Garden',
      districtId: PUNE.id,
      districtName: 'पुणे',
      /* The taluka is kept as written; its id only when it matches the master (here "Haveli", in English). */
      talukaName: 'हवेली',
      talukaId: null,
      division: 'पुणे',
      pinCode: '411001',
      alternateMobile: '+919000000012',
      alternateEmail: 'asha.alt@example.invalid',
      disabilityStatus: false,
      disabilityType: null,
      disabilityCertificateNumber: null,
      qualificationName: 'HSC',
      qualificationStream: 'Science',
      qualificationBoard: 'Maharashtra State Board',
      qualificationCompletedOn: '2021-06-15',
      score: '8.00',
      gradingType: 'CGPA',
      cgpaScale: null,
      qualificationClass: 'A',
      schemeName: 'Synthetic Skill Scheme',
      sourceSubmittedAt: '2026-10-20T04:45:00.000Z',
      sourceUpdatedAt: '2026-10-27T00:29:32.000Z',
      sourceRemarks: 'Synthetic remark: documents checked',
      sourceExtra: {},
    });
  });

  it('matches the taluka within the district by name or code', async () => {
    expect((await importOne({ Taluka: 'haveli' })).row).toMatchObject({ talukaId: HAVELI.id, talukaName: 'haveli' });
    expect((await importOne({ Taluka: 'HAV' })).row.talukaId).toBe(HAVELI.id);
    /* Haveli is a taluka of Pune, not of Nashik. */
    const nashik = await importOne({ District: 'नाशिक', Distrct: 'नाशिक', Taluka: 'Haveli' });
    expect(nashik.row).toMatchObject({ districtId: NASHIK.id, centreCode: 'NAS', talukaId: null, talukaName: 'Haveli' });
  });

  it('a district outside the geography masters stays as written and makes the centre unknown (waivable)', async () => {
    const { row, issues } = await importOne({ District: 'Atlantis', Distrct: '' });
    expect(row).toMatchObject({ districtId: null, districtName: 'Atlantis', centreCode: null, centreFromDistrict: true });
    expect(notDocs(issues)).toEqual(expect.arrayContaining(['course_centre:REF_UNKNOWN']));
  });

  it('a different address district (the "Distrct" column) is kept under its header', async () => {
    const { row } = await importOne({ Distrct: 'नाशिक' });
    expect(row.districtId).toBe(PUNE.id);
    expect(row.sourceExtra).toEqual({ Distrct: 'नाशिक' });
  });

  it('splits the full name on the last word; a one-word name raises a REQUIRED last name naming the column', async () => {
    const three = await importOne({ 'Full Name': '  Kavya   Suresh  More ', applicantName: 'Kavya Suresh More' });
    expect(three.row).toMatchObject({ firstName: 'Kavya Suresh', lastName: 'More', nameKey: 'kavya suresh more' });

    const one = await importOne({ 'Full Name': 'Asha', applicantName: 'Asha' });
    const issue = one.issues.find((i) => i.field === 'last_name')!;
    expect(issue).toMatchObject({ code: 'REQUIRED', message: 'Full Name has only one word: a last name is required' });
  });

  it('uses Applicant name when Full Name is empty, and keeps a different Applicant name', async () => {
    const fallback = await importOne({ 'Full Name': '', applicantName: 'Rohan Vijay Shinde' });
    expect(fallback.row).toMatchObject({ nameFrom: 'applicant_name', firstName: 'Rohan Vijay', lastName: 'Shinde' });
    const differs = await importOne({ 'Full Name': 'Asha Ramesh Patil', applicantName: 'Asha Patil' });
    expect(differs.row.sourceExtra).toEqual({ applicantName: 'Asha Patil' });
  });

  it('prefers the primary mobile; a different form mobile is kept, the same number in another format is not', async () => {
    const different = await importOne({ 'Primary Mobile Number': '9000000011', 'Mobile Number': '9000000013' });
    expect(different.row.mobile).toBe('+919000000011');
    expect(different.row.sourceExtra).toEqual({ 'Mobile Number': '9000000013' });

    const same = await importOne({ 'Primary Mobile Number': '9000000011', 'Mobile Number': '+91 90000 00011' });
    expect(same.row.sourceExtra).toEqual({});

    const noPrimary = await importOne({ 'Primary Mobile Number': '', 'Mobile Number': '9000000014' });
    expect(noPrimary.row.mobile).toBe('+919000000014');
  });

  it('accepts the source spelling हिंदु as the religion हिंदू', async () => {
    const { row, issues } = await importOne({ Religion: 'हिंदु' });
    expect(row.religion).toBe('हिंदू');
    expect(issues.filter((i) => i.field === 'religion')).toEqual([]);
  });

  it.each([
    ['PENDING', 'approval_status:NOT_APPROVED'],
    ['Under Review', 'approval_status:NOT_APPROVED'],
    ['submitted', 'approval_status:NOT_APPROVED'],
    ['REJECTED', 'approval_status:EVIDENCE_MISSING'],
    ['Withdrawn', 'approval_status:EVIDENCE_MISSING'],
    ['', 'approval_status:EVIDENCE_MISSING'],
  ])('status %j raises %s', async (status, issue) => {
    const { row, issues } = await importOne({ status });
    expect(notDocs(issues)).toEqual([issue]);
    expect(row.approvedAt).toBeNull();
  });

  it('an approved row without Approved at takes its approval date from lastUpdated (IST)', async () => {
    const { row, issues } = await importOne({ status: 'APPROVED', lastUpdated: '2026-10-27 05:59:32' });
    expect(notDocs(issues)).toEqual([]);
    expect(row).toMatchObject({ approvalStatus: 'APPROVED', approvedAt: '2026-10-27T00:29:32.000Z' });
  });

  it('an approved row with neither Approved at nor a valid lastUpdated has no approval evidence', async () => {
    expect(notDocs((await importOne({ status: 'APPROVED', lastUpdated: '' })).issues)).toEqual(['approved_at:EVIDENCE_MISSING']);
    const garbage = await importOne({ status: 'APPROVED', lastUpdated: 'Oct 27 2026' });
    expect(notDocs(garbage.issues)).toEqual(expect.arrayContaining(['approved_at:EVIDENCE_MISSING', 'source_updated_at:FORMAT_INVALID']));
  });

  it('an invalid PIN code raises FORMAT_INVALID, leaves the field empty and keeps the value', async () => {
    const { row, issues } = await importOne({ Pincode: '41100' });
    expect(notDocs(issues)).toEqual(['approval_status:NOT_APPROVED', 'pin_code:FORMAT_INVALID']);
    expect(row.pinCode).toBeNull();
    expect(row.sourceExtra).toEqual({ Pincode: '41100' });
  });

  it.each([
    [{ 'Alternate Mobile Number': '12345' }, 'alternate_mobile_number', 'Alternate Mobile Number', 'alternateMobile'],
    [{ 'Alernate Email': 'not-an-email' }, 'alternate_email', 'Alernate Email', 'alternateEmail'],
    [{ 'Are you a disabled person ?': 'Maybe' }, 'disability_status', 'Are you a disabled person ?', 'disabilityStatus'],
    [{ 'Date Of Qualification Completion': '15/06/2021' }, 'qualification_completed_on', 'Date Of Qualification Completion', 'qualificationCompletedOn'],
    [{ 'Percentage /  CGPA': '120' }, 'score', 'Percentage /  CGPA', 'score'],
    [{ submissionDate: '20-10-2026' }, 'submitted_at', 'submissionDate', 'sourceSubmittedAt'],
  ])('%j: FORMAT_INVALID on %s, value kept under "%s"', async (over, field, header, key) => {
    const { row, issues } = await importOne(over as Record<string, string>);
    expect(notDocs(issues)).toEqual(['approval_status:NOT_APPROVED', `${field}:FORMAT_INVALID`]);
    expect(issues.find((i) => i.field === field)!.message).toMatch(/if accepted, the field is left empty \(the value is kept\)/);
    expect((row as unknown as Record<string, unknown>)[key]).toBeNull();
    expect(row.sourceExtra).toEqual({ [header]: Object.values(over)[0] });
  });

  it('reads the source wording of gender and marital status; an unknown gender is raised and kept as supplied', async () => {
    expect((await importOne({ Gender: 'स्त्री', 'Marital Status': 'विवाहित' })).row).toMatchObject({ gender: 'Female', maritalStatus: 'Married' });
    expect((await importOne({ Gender: 'M', 'Marital Status': 'single' })).row).toMatchObject({ gender: 'Male', maritalStatus: 'Unmarried' });

    const unknown = await importOne({ Gender: 'Other' });
    expect(notDocs(unknown.issues)).toEqual(['approval_status:NOT_APPROVED', 'gender:REF_UNKNOWN']);
    expect(unknown.row.gender).toBe('Other');
    expect(unknown.row.sourceExtra).toEqual({});
  });

  it('reads the score as a percentage, a CGPA or a CGPA on a written scale', async () => {
    expect((await importOne({ 'Percentage /  CGPA': '78.5' })).row).toMatchObject({ score: '78.50', gradingType: 'PERCENTAGE', cgpaScale: null });
    expect((await importOne({ 'Percentage /  CGPA': '8.2/10' })).row).toMatchObject({ score: '8.20', gradingType: 'CGPA', cgpaScale: 10 });
    expect((await importOne({ 'Percentage /  CGPA': 'NA' })).row).toMatchObject({ score: null, gradingType: null });
  });
});

describe('parseScore', () => {
  it.each([
    ['8', { score: '8.00', gradingType: 'CGPA', cgpaScale: null }],
    ['78.5', { score: '78.50', gradingType: 'PERCENTAGE', cgpaScale: null }],
    ['78.5%', { score: '78.50', gradingType: 'PERCENTAGE', cgpaScale: null }],
    ['78,5 %', { score: '78.50', gradingType: 'PERCENTAGE', cgpaScale: null }],
    ['8.2/10', { score: '8.20', gradingType: 'CGPA', cgpaScale: 10 }],
    ['3.6 / 4', { score: '3.60', gradingType: 'CGPA', cgpaScale: 4 }],
    ['8.2 CGPA', { score: '8.20', gradingType: 'CGPA', cgpaScale: null }],
    ['100', { score: '100.00', gradingType: 'PERCENTAGE', cgpaScale: null }],
  ])('%j → %j', (v, expected) => {
    expect(parseScore(v)).toEqual(expected);
  });

  it.each(['120', '101%', '11/10', '8/7', '12 CGPA', 'first class', ''])('%j is not a score', (v) => {
    expect(parseScore(v)).toBeNull();
  });
});

describe('parseSourceTimestamp', () => {
  it.each([
    ['2026-10-27 05:59:32', '2026-10-27T00:29:32.000Z'],
    ['2026-10-27T05:59', '2026-10-27T00:29:00.000Z'],
    ['2026-01-10T06:30:00Z', '2026-01-10T06:30:00.000Z'],
    ['2026-01-10T06:30:00+05:30', '2026-01-10T01:00:00.000Z'],
    ['2026-01-10 06:30:00 +0000', '2026-01-10T06:30:00.000Z'],
    ['2026-01-10T06:30:00.123Z', '2026-01-10T06:30:00.123Z'],
    ['2026-01-10', '2026-01-10T00:00:00.000Z'],
  ])('%j → %s', (v, iso) => {
    expect(parseSourceTimestamp(v)).toBe(iso);
  });

  it.each(['Jan 10 2026', '10/01/2026 06:30', '2026-02-30 10:00:00', '2026-01-10 24:00:00', '2026-01-10 10:60', 'yesterday', ''])(
    '%j is refused',
    (v) => {
      expect(parseSourceTimestamp(v)).toBeNull();
    },
  );
});

describe('geography lookup', () => {
  it('matches a district by code, English name, a Marathi name or a former name', () => {
    const geo = buildGeographyLookup(
      [PUNE, { id: id(), code: 'CSN', name: 'Chhatrapati Sambhajinagar' }, { id: id(), code: 'AHL', name: 'Ahilyanagar' }],
      [],
    );
    expect(geo.district('PUN')?.id).toBe(PUNE.id);
    expect(geo.district(' pune ')?.id).toBe(PUNE.id);
    expect(geo.district('पुणे')?.id).toBe(PUNE.id);
    expect(geo.district('Poona')?.id).toBe(PUNE.id);
    expect(geo.district('औरंगाबाद')?.code).toBe('CSN');
    expect(geo.district('Ahmednagar')?.code).toBe('AHL');
    /* An alias of a district that is not in the master matches nothing. */
    expect(geo.district('नाशिक')).toBeNull();
    expect(geo.district('')).toBeNull();
  });

  it('a district or taluka without a code (the column is nullable) matches by name; it never breaks the lookup', () => {
    const noCode = { id: id(), code: null, name: 'Mulshi', districtId: PUNE.id };
    const districtNoCode = { id: id(), code: null, name: 'Test District' };
    const geo = buildGeographyLookup([PUNE, districtNoCode], [noCode]);
    expect(geo.taluka(PUNE.id, 'mulshi')?.id).toBe(noCode.id);
    expect(geo.district('Test District')?.id).toBe(districtNoCode.id);
    expect(geo.district('PUN')?.id).toBe(PUNE.id);
  });
});

describe('XLSX cells', () => {
  it('reads a date-time cell as "YYYY-MM-DD HH:mm:ss" (source time zone), a date cell as YYYY-MM-DD, a percent cell as the percentage shown', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('approver_dashboard');
    ws.addRow(APPROVER_HEADER);
    const values = approverRow();
    const typed: Record<string, ExcelJS.CellValue> = {
      ...values,
      submissionDate: new Date(Date.UTC(2026, 9, 20, 10, 15, 0)),
      lastUpdated: new Date(Date.UTC(2026, 9, 27, 5, 59, 32)),
      'Date Of Birth': new Date(Date.UTC(2003, 3, 12)),
      'Percentage /  CGPA': 0.785,
      Pincode: 411001,
    };
    const row = ws.addRow(APPROVER_HEADER.map((h) => typed[h] ?? ''));
    row.getCell(APPROVER_HEADER.indexOf('Percentage /  CGPA') + 1).numFmt = '0.0%';
    row.getCell(APPROVER_HEADER.indexOf('lastUpdated') + 1).numFmt = 'yyyy-mm-dd hh:mm:ss';
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const parsed = await parseImportFile(buf, 10);
    expect(parsed.mapping).toEqual(EXPECTED_MAPPING);
    expect(parsed.rows[0]).toMatchObject({
      submitted_at: '2026-10-20 10:15:00',
      source_updated_at: '2026-10-27 05:59:32',
      date_of_birth: '2003-04-12',
      score: '78.5',
      pin_code: '411001',
    });

    const { row: n } = validateRow(parsed.rows[0], masters, { geography, extra: parsed.extras[0], mapping: parsed.mapping });
    expect(n).toMatchObject({
      sourceSubmittedAt: '2026-10-20T04:45:00.000Z',
      sourceUpdatedAt: '2026-10-27T00:29:32.000Z',
      dateOfBirth: '2003-04-12',
      score: '78.50',
      gradingType: 'PERCENTAGE',
      pinCode: '411001',
    });
  });
});
