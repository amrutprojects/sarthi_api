import type { Express } from 'express';
import { mastersService } from '../../../src/modules/masters';
import { withVerhoeffDigit } from '../../../src/modules/students/aadhaar';
import { loadGeographyLookup } from '../../../src/modules/students/import/geography';
import { validateRow } from '../../../src/modules/students/import/row-validator';
import { matchStudent } from '../../../src/modules/students/lms-integration/student-match';
import { IMPORT_COLUMNS } from '../../../src/modules/students/student.constants';
import { API, auth, createUser, login, request, setupTestApp, teardownTestApp } from '../../helpers/test-app';

/*
 * M1 rule: the LMS match uses the same rules and gives the same results as the import's matching. The import is not
 * changed; this test runs the real import (upload → row match) and the LMS matcher on the same register and the same
 * people, and requires the same tier and the same student for every case.
 */
let app: Express;
let op: string;
beforeAll(async () => {
  app = await setupTestApp();
  const operator = await createUser({ roleCodes: ['IMPORT_OPERATOR'] });
  const reviewer = await createUser({ roleCodes: ['IMPORT_REVIEWER'] });
  op = await login(operator.email);
  const rv = await login(reviewer.email);
  /* The register: two imported students. */
  const up = await upload([BASE, OTHER]);
  const fin = await request(app).post(`${API}/imports/${up.id}/finalise`).set(auth(rv)).send({ confirmCode: up.code });
  expect(fin.status).toBe(200);
});
afterAll(teardownTestApp);

const HEADER = IMPORT_COLUMNS.map((c) => c.field);
let n = 0;
function record(over: Record<string, string> = {}): Record<string, string> {
  n++;
  const v: Record<string, string> = {
    source_record_id: `MA-PAR-${n}`,
    first_name: 'Kavya',
    last_name: 'Parity',
    father_name: 'Ramesh',
    mother_name: 'Sunita',
    email: `kavya${n}@example.invalid`,
    date_of_birth: '2002-02-02',
    current_address: 'Flat 0, Test Lane',
    aadhaar_number: withVerhoeffDigit(`4567890${String(10000 + n).slice(-4)}`),
    mobile_number: `97${String(10000000 + n).slice(-8)}`,
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
const BASE = record();
const OTHER = record({ first_name: 'Meera', last_name: 'Other', date_of_birth: '1999-09-09' });

const csv = (rows: Record<string, string>[]) =>
  Buffer.from([HEADER.join(','), ...rows.map((r) => HEADER.map((h) => `"${(r[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n'));
let files = 0;
async function upload(rows: Record<string, string>[]) {
  const res = await request(app).post(`${API}/imports`).set(auth(op)).attach('file', csv(rows), `parity-${++files}.csv`);
  expect([200, 201]).toContain(res.status);
  return res.body.data as { id: string; code: string };
}

/* What the import decides for this person (one row in its own batch), and what the LMS matcher decides. */
async function both(person: Record<string, string>) {
  const batch = await upload([person]);
  const rows = (await request(app).get(`${API}/imports/${batch.id}/rows`).set(auth(op))).body.data as {
    match: { tier: string; studentId: string | null } | null;
  }[];
  const imported = rows[0].match ? { tier: rows[0].match.tier, studentId: rows[0].match.studentId } : { tier: null, studentId: null };
  const [masters, geography] = await Promise.all([mastersService.loadLookup(), loadGeographyLookup()]);
  const { row } = validateRow(person, masters, { geography });
  const o = await matchStudent(row);
  return { imported, lms: { tier: o.tier, studentId: o.student?.id ?? null } };
}

describe('LMS match ≡ import match', () => {
  const cases: [string, () => Record<string, string>, string | null][] = [
    ['T0 same source record ID (unchanged)', () => ({ ...BASE }), 'T0'],
    ['T0 same source record ID, values differ', () => ({ ...BASE, landmark: 'x', email: 'changed@example.invalid' }), 'T0'],
    ['T1 same Aadhaar, same name and DOB', () => record({ aadhaar_number: BASE.aadhaar_number }), 'T1'],
    ['T1 same Aadhaar, different DOB (conflict)', () => record({ aadhaar_number: BASE.aadhaar_number, date_of_birth: '2001-01-01' }), 'T1'],
    ['T2 same name + DOB + mobile', () => record({ mobile_number: BASE.mobile_number }), 'T2'],
    [
      'T2 same name (case, spaces) + DOB + email',
      () => record({ first_name: ' KAVYA ', last_name: 'parity', email: BASE.email.toUpperCase() }),
      'T2',
    ],
    ['T3 same mobile only', () => record({ first_name: 'Someone', mobile_number: `+91 ${BASE.mobile_number}` }), 'T3'],
    ['T3 same email only', () => record({ first_name: 'Someone', date_of_birth: '1990-01-01', email: OTHER.email }), 'T3'],
    ['no match', () => record({ first_name: 'Nobody' }), null],
    ['name + DOB without contact: no match', () => record(), null],
  ];
  it.each(cases)('%s', async (_name, make, tier) => {
    const { imported, lms } = await both(make());
    expect(lms).toEqual(imported);
    expect(lms.tier).toBe(tier);
  });
});
