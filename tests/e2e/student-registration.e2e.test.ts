/* Raise the per-IP registration limit for this suite (the limit itself is tested in student-registration-rate-limit). */
process.env.REGISTRATION_RATE_LIMIT_MAX = '1000';

import type { Express } from 'express';
import { Repository } from 'typeorm';
import { AppDataSource } from '../../src/config/database.config';
import { HTTP_STATUS } from '../../src/constants/api-response.constants';
import { AuditLog, Student } from '../../src/database/entities';
import { decryptAadhaar, withVerhoeffDigit } from '../../src/modules/students/aadhaar';
import { API, request, resetData, setupTestApp, teardownTestApp } from '../helpers/test-app';

let app: Express;
beforeAll(async () => {
  app = await setupTestApp();
});
beforeEach(resetData);
afterAll(teardownTestApp);

const URL = `${API}/student-registrations`;
let seq = 0;
const aadhaar = () => withVerhoeffDigit(`4567890${String(10000 + ++seq).slice(-4)}`);

function registration(over: Record<string, unknown> = {}): Record<string, unknown> {
  const n = ++seq;
  return {
    first_name: 'Asha',
    last_name: 'Patil',
    father_name: 'Ramesh Patil',
    mother_name: 'Sunita Patil',
    email: `asha${n}@example.invalid`,
    date_of_birth: '2003-04-12',
    current_address: 'Flat 4, Shivaji Nagar, Pune',
    aadhaar_number: aadhaar(),
    mobile_number: `98765${String(10000 + n).slice(-5)}`,
    religion: 'हिंदू',
    caste: 'मराठी',
    course_centre: 'Pune',
    technology: 'Web Design & Development',
    education_qualification: 'B.Com',
    declaration_accepted: true,
    ...over,
  };
}

const fields = (res: { body: { error?: { details?: { field: string }[] } } }) => (res.body.error?.details ?? []).map((d) => d.field);

describe('POST /student-registrations', () => {
  it('creates a pending, unapproved registration with normalised, protected data', async () => {
    const body = registration({ email: ' Asha.P@Example.Invalid ', mobile_number: '+91 98765 43210', course_centre: 'pun' });
    const res = await request(app).post(URL).send(body);
    expect(res.status).toBe(HTTP_STATUS.CREATED);
    expect(res.body).toEqual({
      success: true,
      status: 201,
      message: 'Registration submitted successfully',
      data: { registration_id: expect.stringMatching(/^REG-\d{6}$/), status: 'REGISTRATION_PENDING' },
    });
    expect(JSON.stringify(res.body)).not.toContain(body.aadhaar_number as string);

    const s = await AppDataSource.getRepository(Student).findOneByOrFail({ code: res.body.data.registration_id });
    expect(s).toMatchObject({
      status: 'REGISTRATION_PENDING',
      source: 'PUBLIC_REGISTRATION',
      externalStatus: 'PENDING',
      approvedAt: null,
      importBatchId: null,
      sourceRecordId: null,
      email: 'asha.p@example.invalid',
      mobile: '+919876543210',
      centreCode: 'PUN',
      trackCode: 'T03',
      declarationAccepted: true,
      aadhaarLast4: (body.aadhaar_number as string).slice(-4),
    });
    expect(decryptAadhaar(s.aadhaarEnc as Buffer)).toBe(body.aadhaar_number);

    const audit = await AppDataSource.getRepository(AuditLog).findOneByOrFail({ action: 'student.registration.create' });
    expect(JSON.stringify(audit)).not.toContain(body.aadhaar_number as string);
    expect(JSON.stringify(audit)).not.toContain('asha.p@example.invalid');
  });

  it('rejects missing required fields with field-specific errors', async () => {
    const res = await request(app).post(URL).send({ first_name: 'Asha' });
    expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(res.body).toMatchObject({ success: false, status: 422, data: null, error: { code: 'VALIDATION_ERROR' } });
    expect(fields(res)).toEqual(expect.arrayContaining(['body.last_name', 'body.aadhaar_number', 'body.declaration_accepted']));
  });

  it('rejects invalid formats, types and reference values using the import rules', async () => {
    const res = await request(app)
      .post(URL)
      .send(
        registration({
          email: 'not-an-email',
          date_of_birth: '12/04/2003',
          aadhaar_number: '234567890123',
          mobile_number: '12345',
          caste: 'Unknown',
          course_centre: 'Atlantis',
          technology: 'Accounting & Financial Management',
          first_name: 'Asha123',
        }),
      );
    expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(fields(res).sort()).toEqual(
      [
        'body.aadhaar_number',
        'body.caste',
        'body.course_centre',
        'body.date_of_birth',
        'body.email',
        'body.first_name',
        'body.mobile_number',
        'body.technology',
      ].sort(),
    );
    expect(JSON.stringify(res.body)).not.toContain('234567890123');

    const wrongType = await request(app)
      .post(URL)
      .send(registration({ mobile_number: 9876543210, declaration_accepted: 'yes' }));
    expect(wrongType.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(fields(wrongType)).toEqual(expect.arrayContaining(['body.mobile_number', 'body.declaration_accepted']));
  });

  it('rejects client-supplied status, approval and internal identifiers', async () => {
    for (const extra of [
      { status: 'APPROVED' },
      { approval_status: 'APPROVED' },
      { approved_at: '2026-01-01' },
      { source_record_id: 'MA-1' },
      { code: 'STU-000001' },
      { importBatchId: '00000000-0000-0000-0000-000000000000' },
    ]) {
      const res = await request(app).post(URL).send(registration(extra));
      expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    }
    expect(await AppDataSource.getRepository(Student).count()).toBe(0);
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await request(app).post(URL).set('Content-Type', 'application/json').send('{"first_name":');
    expect(res.status).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  it('rejects a duplicate Aadhaar with 409, and flags a same name + DOB + mobile match without rejecting', async () => {
    const first = registration();
    expect((await request(app).post(URL).send(first)).status).toBe(HTTP_STATUS.CREATED);

    const dup = await request(app)
      .post(URL)
      .send(registration({ aadhaar_number: first.aadhaar_number }));
    expect(dup.status).toBe(HTTP_STATUS.CONFLICT);
    expect(dup.body).toMatchObject({ success: false, status: 409, data: null, error: { code: 'CONFLICT' } });

    const similar = await request(app)
      .post(URL)
      .send(registration({ mobile_number: first.mobile_number }));
    expect(similar.status).toBe(HTTP_STATUS.CREATED);
    const audits = await AppDataSource.getRepository(AuditLog).find({ where: { action: 'student.registration.create' } });
    const flagged = audits.find((a) => (a.details as { code?: string })?.code === similar.body.data.registration_id);
    expect((flagged?.details as { possibleDuplicateOf?: string }).possibleDuplicateOf).toMatch(/^REG-/);
  });

  it('allows only one of several concurrent submissions with the same Aadhaar', async () => {
    const same = aadhaar();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post(URL)
          .send(registration({ aadhaar_number: same })),
      ),
    );
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([201, 409, 409, 409, 409]);
    expect(await AppDataSource.getRepository(Student).count()).toBe(1);
  });

  it('returns 500 with a generic message, and stores nothing, when the database write fails', async () => {
    const spy = jest.spyOn(Repository.prototype, 'save').mockRejectedValueOnce(new Error('connection lost: secret detail'));
    const res = await request(app).post(URL).send(registration());
    spy.mockRestore();
    expect(res.status).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
    expect(res.body).toMatchObject({ success: false, status: 500, data: null, message: 'Internal server error' });
    expect(JSON.stringify(res.body)).not.toContain('secret detail');
    expect(await AppDataSource.getRepository(Student).count()).toBe(0);
  });

  it('does not require authentication and is not blocked by CSRF', async () => {
    const res = await request(app).post(URL).set('Origin', 'http://localhost:5173').send(registration());
    expect(res.status).toBe(HTTP_STATUS.CREATED);
  });
});
