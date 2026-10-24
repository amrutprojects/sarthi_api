import '../../helpers/unit-env';
import { registrationBody } from '../../../src/modules/students/registration/registration.validation';
import { withVerhoeffDigit } from '../../../src/modules/students/aadhaar';

const valid = {
  first_name: 'Asha',
  last_name: 'Patil',
  father_name: 'Ramesh Patil',
  mother_name: 'Sunita Patil',
  email: 'asha@example.invalid',
  date_of_birth: '2003-04-12',
  current_address: 'Pune',
  aadhaar_number: withVerhoeffDigit('23456789012'),
  mobile_number: '+91 98765 43210',
  religion: 'हिंदू',
  caste_id: '3f1c2a9e-5b7d-4e61-9a0b-2c4d6e8f1a01',
  region_id: '7a2b4c6d-8e0f-4a1b-9c3d-5e7f9a1b3c02',
  technology: 'T03',
  education_id: 'b4d6f8a0-2c4e-4f6a-8b0c-1d3e5f7a9b03',
  declaration_accepted: true,
};
const messages = (body: Record<string, unknown>) => {
  const r = registrationBody.safeParse(body);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]));
};

describe('registration request validation', () => {
  it('accepts a valid body', () => {
    expect(registrationBody.safeParse(valid).success).toBe(true);
  });

  it.each([['रमेश पाटील'], ["D'Souza"], ['R. K. Patil-Deshmukh']])('accepts the parent name %s', (name) => {
    expect(registrationBody.safeParse({ ...valid, father_name: name, mother_name: name }).success).toBe(true);
  });

  it('names every missing field', () => {
    const m = messages({});
    expect(m).toMatchObject({
      first_name: 'First name is required',
      email: 'Email is required',
      aadhaar_number: 'Aadhaar number is required',
      region_id: 'Region (course centre) is required',
      caste_id: 'Caste is required',
      education_id: 'Education is required',
      declaration_accepted: 'The declaration must be accepted',
    });
  });

  it.each([
    [{ first_name: '   ' }, 'first_name', 'First name is required'],
    [{ first_name: 'Asha1' }, 'first_name', "First name may contain only letters, spaces and . ' -"],
    [{ father_name: 'Ramesh 2' }, 'father_name', "Father name may contain only letters, spaces and . ' -"],
    [{ father_name: 'Ramesh@Patil' }, 'father_name', "Father name may contain only letters, spaces and . ' -"],
    [{ mother_name: 'Sunita#' }, 'mother_name', "Mother name may contain only letters, spaces and . ' -"],
    [{ mother_name: '-Sunita' }, 'mother_name', "Mother name may contain only letters, spaces and . ' -"],
    [{ email: 'x@y' }, 'email', 'Email address is not valid'],
    [{ date_of_birth: '12/04/2003' }, 'date_of_birth', 'Date of birth must be in YYYY-MM-DD format'],
    [{ date_of_birth: '2003-02-30' }, 'date_of_birth', 'Date of birth is not a real date'],
    [{ date_of_birth: '2099-01-01' }, 'date_of_birth', 'Date of birth cannot be in the future'],
    [{ date_of_birth: '2020-01-01' }, 'date_of_birth', 'Applicant must be between 14 and 100 years old'],
    [{ aadhaar_number: '234567890123' }, 'aadhaar_number', 'Aadhaar number must be 12 digits with a valid checksum'],
    [{ mobile_number: '5876543210' }, 'mobile_number', 'Mobile number must be a 10-digit Indian number starting 6–9'],
    [{ religion: 'Other' }, 'religion', 'Religion is not in the reference list'],
    [{ region_id: 'pune' }, 'region_id', 'Must be a valid UUID'],
    [{ first_name: 5 }, 'first_name', 'First name must be text'],
    [
      { documents: [{ document_type_id: valid.caste_id }, { document_type_id: valid.caste_id }] },
      'documents',
      'Each document type may be listed only once',
    ],
    [{ status: 'APPROVED' }, '', "Unrecognized key(s) in object: 'status'"],
  ])('%j → %s: %s', (over, field, message) => {
    expect(messages({ ...valid, ...over })[field]).toBe(message);
  });
});
