import '../../helpers/unit-env';
import { validateCandidate, validateRow } from '../../../src/modules/students/import/row-validator';
import { registrationBody } from '../../../src/modules/students/registration/registration.validation';
import { IMPORT_COLUMNS, REGISTRATION_FIELDS, REGISTRATION_MASTER_FIELDS } from '../../../src/modules/students/student.constants';
import { withVerhoeffDigit } from '../../../src/modules/students/aadhaar';
import { testMasters } from '../../helpers/masters';

const masters = testMasters();

const person: Record<string, string> = {
  first_name: ' Asha ',
  last_name: 'Patil',
  father_name: 'Ramesh',
  mother_name: 'Sunita',
  email: 'A@Example.Invalid',
  date_of_birth: '2003-04-12',
  current_address: 'Pune',
  aadhaar_number: withVerhoeffDigit('23456789012'),
  mobile_number: '09876543210',
  religion: 'हिंदू',
  caste: 'मराठी',
  course_centre: 'pune',
  technology: 'T03',
  education_qualification: 'B.Com',
  declaration_accepted: 'Yes',
};

describe('registration and import share one field definition', () => {
  it('registration fields are import columns, and the request schema accepts exactly those', () => {
    const importFields = new Set(IMPORT_COLUMNS.map((c) => c.field));
    for (const f of REGISTRATION_FIELDS) expect(importFields.has(f)).toBe(true);
    /* Master-backed fields arrive as ids; declared documents are an extra optional list. */
    const expected = [...REGISTRATION_FIELDS.map((f) => REGISTRATION_MASTER_FIELDS[f] ?? f), 'documents'];
    expect(Object.keys(registrationBody.shape).sort()).toEqual(expected.sort());
  });

  it('normalises personal details identically', () => {
    const { fields } = validateCandidate(person, masters);
    const { row } = validateRow({ ...person, source_record_id: 'MA-1', approval_status: 'APPROVED', approved_at: '2026-01-01T00:00:00Z' }, masters);
    const { aadhaarEnc: _a, ...fromCandidate } = fields;
    const { aadhaarEnc: _b, ...fromRow } = row;
    expect(fromRow).toMatchObject(fromCandidate);
    expect(fields).toMatchObject({ firstName: 'Asha', email: 'a@example.invalid', mobile: '+919876543210', centreCode: 'PUN' });
  });

  it('reports the same personal-field issues', () => {
    const bad = { ...person, email: 'x', aadhaar_number: '123', mobile_number: '1', caste: '?' };
    const personal = new Set(REGISTRATION_FIELDS as readonly string[]);
    const fromRow = validateRow(bad, masters)
      .issues.filter((i) => personal.has(i.field))
      .map((i) => i.code);
    expect(validateCandidate(bad, masters).issues.map((i) => i.code)).toEqual(fromRow);
  });
});
