import { EMPTY_GEOGRAPHY } from '../../../src/modules/students/import/geography';
import { withVerhoeffDigit } from '../../../src/modules/students/aadhaar';
import { normaliseLmsStudent } from '../../../src/modules/students/lms-integration/lms-student.fields';
import { decideMatch, resultOf, type MatchCandidates } from '../../../src/modules/students/lms-integration/student-match';
import { testMasters } from '../../helpers/masters';

const masters = testMasters();
const AADHAAR = withVerhoeffDigit('23456789012');

const person = (over: Record<string, unknown> = {}) => ({
  first_name: 'Asha',
  last_name: 'Patil',
  father_name: 'Ramesh Patil',
  mother_name: 'Sunita Patil',
  email: 'Asha.Patil@Example.invalid',
  date_of_birth: '2003-04-12',
  gender: 'Female',
  permanent_address: 'House 2, Sample Road',
  landmark: 'Near Test Garden',
  district: 'Pune',
  taluka: 'Haveli',
  division: 'Pune',
  pin_code: '411001',
  mobile_number: '9000000011',
  ...over,
});
const probe = (over: Record<string, unknown> = {}) => {
  const { row } = normaliseLmsStudent(person(over), masters, EMPTY_GEOGRAPHY);
  return row;
};
const student = (over: Record<string, unknown> = {}) => ({
  id: 'id-1',
  code: 'STU-000001',
  sourceRecordId: null as string | null,
  aadhaarBidx: null as string | null,
  dateOfBirth: '2003-04-12' as string | null,
  firstName: 'Asha',
  lastName: 'Patil',
  mobile: '+919000000011' as string | null,
  email: 'asha.patil@example.invalid' as string | null,
  ...over,
});
const none = (): MatchCandidates => ({ bySrc: [], byBidx: [], byDob: [], byMobile: [], byEmail: [] });

describe('LMS student normalisation (the import validator, called as it is)', () => {
  it('normalises like an imported row: +91 mobile, lower-case email, name key, Aadhaar blind index', () => {
    const row = probe({ aadhaar_number: AADHAAR, first_name: '  Asha  ', last_name: 'PATIL' });
    expect(row.mobile).toBe('+919000000011');
    expect(row.email).toBe('asha.patil@example.invalid');
    expect(row.nameKey).toBe('asha patil');
    expect(row.aadhaarBidx).toMatch(/^[0-9a-f]{64}$/);
    expect(row.aadhaarLast4).toBe(AADHAAR.slice(-4));
  });

  it('requires the LMS set, not the import-only fields, and reports {field, code} only', () => {
    const ok = normaliseLmsStudent(person(), masters, EMPTY_GEOGRAPHY);
    expect(ok.errors).toEqual([]);
    const bad = normaliseLmsStudent(person({ gender: '', email: 'not-an-email', aadhaar_number: '123' }), masters, EMPTY_GEOGRAPHY);
    expect(bad.errors).toEqual(
      expect.arrayContaining([
        { field: 'email', code: 'email_invalid' },
        { field: 'aadhaar_number', code: 'aadhaar_invalid' },
        { field: 'gender', code: 'required' },
      ]),
    );
    expect(JSON.stringify(bad.errors)).not.toContain('not-an-email');
    expect(bad.errors.map((e) => e.field)).not.toEqual(expect.arrayContaining(['religion', 'caste', 'current_address', 'technology']));
  });
});

describe('tier decision (same rules as the import)', () => {
  it('T0: same source record ID → MATCH', () => {
    const o = decideMatch(probe({ source_record_id: 'MA-1' }), { ...none(), bySrc: [student({ sourceRecordId: 'MA-1' })] });
    expect(o).toMatchObject({ tier: 'T0', student: { id: 'id-1' } });
    expect(resultOf(o)).toBe('MATCH');
  });

  it('T1: same Aadhaar and same name + DOB → MATCH; different DOB → POSSIBLE (conflict)', () => {
    const row = probe({ aadhaar_number: AADHAAR });
    const same = decideMatch(row, { ...none(), byBidx: [student({ aadhaarBidx: row.aadhaarBidx })] });
    expect(same).toMatchObject({ tier: 'T1', conflict: false });
    expect(resultOf(same)).toBe('MATCH');
    const other = decideMatch(row, { ...none(), byBidx: [student({ aadhaarBidx: row.aadhaarBidx, dateOfBirth: '2001-01-01' })] });
    expect(other).toMatchObject({ tier: 'T1', conflict: true });
    expect(resultOf(other)).toBe('POSSIBLE');
  });

  it('T0 wins over T1, T1 over T2', () => {
    const row = probe({ source_record_id: 'MA-1', aadhaar_number: AADHAAR });
    const c = {
      ...none(),
      bySrc: [student({ id: 's0', sourceRecordId: 'MA-1' })],
      byBidx: [student({ id: 's1', aadhaarBidx: row.aadhaarBidx })],
      byDob: [student({ id: 's2' })],
    };
    expect(decideMatch(row, c).student?.id).toBe('s0');
    expect(decideMatch(row, { ...c, bySrc: [] }).student?.id).toBe('s1');
    expect(decideMatch(row, { ...c, bySrc: [], byBidx: [] }).student?.id).toBe('s2');
  });

  it('T2: same name (case and spaces ignored) + DOB + mobile or email → POSSIBLE; name alone is not enough', () => {
    const row = probe();
    const t2 = decideMatch(row, { ...none(), byDob: [student({ firstName: 'ASHA ', lastName: ' patil', email: null })] });
    expect(t2).toMatchObject({ tier: 'T2', student: { id: 'id-1' } });
    expect(resultOf(t2)).toBe('POSSIBLE');
    const noContact = decideMatch(row, { ...none(), byDob: [student({ mobile: '+919999999999', email: 'x@example.invalid' })] });
    expect(noContact.tier).toBeNull();
  });

  it('T3: contact only → NONE, information only (no student returned)', () => {
    const o = decideMatch(probe(), { ...none(), byMobile: [student({ firstName: 'Other', dateOfBirth: '1999-01-01' })] });
    expect(o).toMatchObject({ tier: 'T3', student: null });
    expect(resultOf(o)).toBe('NONE');
  });

  it('nothing in common → NONE', () => {
    const o = decideMatch(probe(), none());
    expect(o).toEqual({ tier: null, student: null, conflict: false, note: null });
    expect(resultOf(o)).toBe('NONE');
  });
});
