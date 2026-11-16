import { IMPORT_COLUMNS } from '../../../src/modules/students/student.constants';
import { rowChecksum, validateRow } from '../../../src/modules/students/import/row-validator';
import { decryptAadhaar, verhoeffValid, withVerhoeffDigit } from '../../../src/modules/students/aadhaar';
import { testMasters } from '../../helpers/masters';

const masters = testMasters();

/* A valid source row per the received-data field mapping (spec Table 81). */
function row(over: Record<string, string> = {}): Record<string, string> {
  const v: Record<string, string> = {
    source_record_id: 'MA-1',
    first_name: 'Asha',
    last_name: 'Patil',
    father_name: 'Ramesh',
    mother_name: 'Sunita',
    email: 'Asha.Patil@Example.org',
    date_of_birth: '2003-04-12',
    current_address: 'Flat 1\nSample Nagar',
    aadhaar_number: withVerhoeffDigit('23456789012'),
    mobile_number: '+91 98765 43210',
    religion: 'हिंदू',
    caste: 'ब्राह्मण',
    course_centre: 'Pune',
    technology: 'AI-ML Engineer',
    education_qualification: 'Graduate',
    approval_status: 'approved',
    approved_at: '2026-01-10T06:30:00Z',
  };
  for (const c of IMPORT_COLUMNS.filter((c) => c.field.startsWith('doc_') && !c.field.endsWith('_barcode'))) v[c.field] = 'Yes';
  v.doc_income_ews_barcode = '271234567890123456';
  v.doc_domicile_barcode = '281234567890123456';
  return { ...v, ...over };
}
const codes = (r: Record<string, string>) => validateRow(r, masters).issues.map((i) => i.code);

describe('validateRow', () => {
  /* The source portals' exports still use the master's earlier spellings; they are read as the caste itself. */
  it.each([
    ['गुजराथी', 'गुजराती'],
    ['लोहाणा', 'लोहाना'],
    ['सेनगुप्तर', 'सेनगूनथर'],
    ['कोमटी/वैश्य', 'कोमटी/ वैश्य'],
    ['हिंदू वेरशैव लिंगायत', 'हिंदू / वीरशैव लिंगायत'],
  ])('reads the earlier caste spelling %s as %s', (earlier, official) => {
    const { row: n, issues } = validateRow(row({ caste: earlier }), masters);
    expect(issues).toEqual([]);
    expect(n.caste).toBe(official);
    expect(n.casteId).toBe(masters.find('caste', official)!.id);
  });

  it('accepts a valid row and normalises it', () => {
    const { row: n, issues } = validateRow(row(), masters);
    expect(issues).toEqual([]);
    expect(n).toMatchObject({
      email: 'asha.patil@example.org',
      mobile: '+919876543210',
      centreCode: 'PUN',
      trackCode: 'T08',
      approvalStatus: 'APPROVED',
    });
    expect(n.aadhaarLast4).toHaveLength(4);
    expect(n.currentAddress).toContain('\n');
  });

  it('protects the Aadhaar number: encrypted, blind-indexed, never in the normalised data', () => {
    const digits = withVerhoeffDigit('23456789012');
    const { row: n } = validateRow(row({ aadhaar_number: digits.replace(/(\d{4})(?=\d)/g, '$1 ') }), masters);
    expect(decryptAadhaar(n.aadhaarEnc!)).toBe(digits);
    expect(n.aadhaarBidx).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify({ ...n, aadhaarEnc: undefined })).not.toContain(digits);
  });

  it.each([
    [{ aadhaar_number: '234567890123' }, 'AADHAAR_INVALID'],
    [{ aadhaar_number: '' }, 'REQUIRED'],
    [{ email: 'nope' }, 'EMAIL_INVALID'],
    [{ date_of_birth: '12/04/2003' }, 'DOB_INVALID'],
    [{ date_of_birth: '2003-02-30' }, 'DOB_INVALID'],
    [{ mobile_number: '5123456789' }, 'MOBILE_INVALID'],
    [{ caste: 'Unknown' }, 'REF_UNKNOWN'],
    /* Not in the official target-group list (CasteOfficialList migration). */
    [{ caste: 'मराठी' }, 'REF_UNKNOWN'],
    [{ caste: 'ठाकूर' }, 'REF_UNKNOWN'],
    [{ technology: 'Accounting & Financial Management' }, 'TRACK_NOT_OFFERED'],
    [{ course_centre: 'Atlantis' }, 'REF_UNKNOWN'],
    /* Still under review at the source: waivable (added as pending approval). A closed application is never imported. */
    [{ approval_status: 'PENDING' }, 'NOT_APPROVED'],
    [{ approval_status: 'REJECTED' }, 'EVIDENCE_MISSING'],
    [{ approved_at: 'Jan 10 2026' }, 'EVIDENCE_MISSING'],
    [{ approved_at: '2999-01-01T00:00:00Z' }, 'EVIDENCE_MISSING'],
    [{ first_name: 'Asha2' }, 'NAME_INVALID'],
    [{ father_name: 'Ramesh 2' }, 'NAME_INVALID'],
    [{ mother_name: 'Sunita@' }, 'NAME_INVALID'],
    [{ doc_income_ews_barcode: 'BC-1' }, 'BARCODE_INVALID'],
    [{ doc_income_ews_barcode: '27123456789012345' }, 'BARCODE_INVALID'],
    [{ doc_domicile_barcode: '2812 3456 7890 1234 56' }, 'BARCODE_INVALID'],
    [{ doc_domicile_barcode: '' }, 'REQUIRED'],
    [{ doc_photo: 'No' }, 'DOC_MISSING'],
  ])('%j raises %s', (over, code) => {
    expect(codes(row(over as Record<string, string>))).toContain(code);
  });

  it('never puts an Aadhaar value in an issue message', () => {
    const { issues } = validateRow(row({ aadhaar_number: '234567890123' }), masters);
    expect(JSON.stringify(issues)).not.toContain('234567890123');
  });

  it('checksums are stable regardless of column order', () => {
    expect(rowChecksum({ a: '1', b: '2' })).toBe(rowChecksum({ b: '2', a: '1' }));
  });
});

describe('Verhoeff', () => {
  it('accepts generated check digits and rejects single-digit errors', () => {
    const n = withVerhoeffDigit('98765432109');
    expect(verhoeffValid(n)).toBe(true);
    expect(verhoeffValid(n.slice(0, -1) + String((Number(n.at(-1)) + 1) % 10))).toBe(false);
  });
});
