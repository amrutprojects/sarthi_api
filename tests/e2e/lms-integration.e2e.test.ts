import type { Express } from 'express';
import { AppDataSource } from '../../src/config/database.config';
import { Student } from '../../src/database/entities';
import { withVerhoeffDigit } from '../../src/modules/students/aadhaar';
import { logger } from '../../src/observability/logger';
import { API, actorWith, auth, request, resetData, setupTestApp, superAdmin, teardownTestApp } from '../helpers/test-app';

/*
 * M1 inbound side: Amrut-issued API keys (admin endpoints + X-Api-Key) and the LMS student endpoints
 * (contract lms-api docs/contracts/multi-tenant/amrut-student-api.md §2–§4). Synthetic data only.
 */
let app: Express;
beforeAll(async () => {
  app = await setupTestApp();
});
beforeEach(resetData);
afterAll(teardownTestApp);

const LMS = `${API}/lms-integration`;
let seq = 0;
const aadhaar = () => withVerhoeffDigit(`3456789${String(10000 + ++seq).slice(-4)}`);

/* The body the LMS sends for POST /learners of a linked tenant (amrut-mapping.ts personFromLearnerCreate). */
function lmsPerson(over: Record<string, unknown> = {}): Record<string, unknown> {
  const n = ++seq;
  const letters = n.toString(26).replace(/\d/g, (d) => 'abcdefghij'[+d]);
  return {
    first_name: 'Simulated',
    last_name: `Learner${letters}`,
    father_name: 'Synthetic Father',
    mother_name: 'Synthetic Mother',
    email: `sim.learner${n}@example.invalid`,
    mobile_number: `60000${String(10000 + n).slice(-5)}`,
    date_of_birth: '2004-04-04',
    gender: 'Female',
    permanent_address: 'Synthetic address line 1',
    landmark: 'Synthetic landmark',
    district: 'PUN',
    taluka: 'Haveli',
    division: 'Pune',
    pin_code: '411001',
    lms_tenant_code: 'TEST_TENANT',
    lms_learner_ref: `req-${n}`,
    ...over,
  };
}
const matchBody = (p: Record<string, unknown>) => ({
  source_record_id: p.source_record_id ?? null,
  aadhaar_number: p.aadhaar_number ?? null,
  first_name: p.first_name,
  last_name: p.last_name,
  date_of_birth: p.date_of_birth,
  mobile_number: p.mobile_number,
  email: p.email ?? null,
});

async function newKey(token: string, body: Record<string, unknown> = { label: 'LMS test' }) {
  const res = await request(app).post(`${API}/api-keys`).set(auth(token)).send(body);
  expect(res.status).toBe(201);
  return res.body.data as { key: { id: string; prefix: string }; secret: string };
}
const call = (key: string) => ({
  match: (b: unknown) =>
    request(app)
      .post(`${LMS}/students/match`)
      .set('X-Api-Key', key)
      .send(b as object),
  create: (b: unknown, idem?: string) => {
    const r = request(app).post(`${LMS}/students`).set('X-Api-Key', key);
    return (idem ? r.set('Idempotency-Key', idem) : r).send(b as object);
  },
  patch: (id: string, b: unknown) =>
    request(app)
      .patch(`${LMS}/students/${id}`)
      .set('X-Api-Key', key)
      .send(b as object),
});
const auditRows = async () =>
  (await AppDataSource.query(`SELECT "action", "details"::text AS details, "resourceId" FROM "audit_logs" ORDER BY "createdAt"`)) as {
    action: string;
    details: string | null;
    resourceId: string | null;
  }[];

describe('API key management', () => {
  it('generates (secret once), lists without secrets, rotates with overlap, revokes — audited without the secret', async () => {
    const admin = await superAdmin();
    const { key, secret } = await newKey(admin.token, { label: 'LMS production' });
    expect(secret).toMatch(/^amk_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);

    const list = await request(app).get(`${API}/api-keys`).set(auth(admin.token));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({
      id: key.id,
      state: 'ACTIVE',
      scopes: ['lms.students.match', 'lms.students.create', 'lms.students.update'],
    });
    expect(JSON.stringify(list.body)).not.toContain(secret);
    expect(list.body.data[0]).not.toHaveProperty('secretHash');
    expect((await request(app).get(`${API}/api-keys/${key.id}`).set(auth(admin.token))).body.data.id).toBe(key.id);

    const rot = await request(app).post(`${API}/api-keys/${key.id}/rotate`).set(auth(admin.token)).send({ overlapMinutes: 60 });
    expect(rot.status).toBe(201);
    expect(rot.body.data.previous).toMatchObject({ id: key.id, state: 'EXPIRING', replacedById: rot.body.data.key.id });
    expect(rot.body.data.secret).not.toBe(secret);
    /* Both keys work during the overlap. */
    expect((await call(secret).match(matchBody(lmsPerson()))).status).toBe(200);
    expect((await call(rot.body.data.secret).match(matchBody(lmsPerson()))).status).toBe(200);
    /* An expiring key cannot be rotated again. */
    expect((await request(app).post(`${API}/api-keys/${key.id}/rotate`).set(auth(admin.token)).send({})).status).toBe(409);

    const rev = await request(app)
      .post(`${API}/api-keys/${rot.body.data.key.id}/revoke`)
      .set(auth(admin.token))
      .send({ reason: 'test revoke' });
    expect(rev.status).toBe(200);
    expect(rev.body.data).toMatchObject({ state: 'REVOKED', revokedReason: 'test revoke' });
    expect(
      (await request(app).post(`${API}/api-keys/${rot.body.data.key.id}/revoke`).set(auth(admin.token)).send({ reason: 'again' })).status,
    ).toBe(409);
    expect((await call(rot.body.data.secret).match(matchBody(lmsPerson()))).status).toBe(401);

    const audit = await auditRows();
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['api_key.created', 'api_key.rotated', 'api_key.revoked', 'api_key.denied']),
    );
    const all = JSON.stringify(audit);
    expect(all).not.toContain(secret);
    expect(all).not.toContain(rot.body.data.secret);
  });

  it('is permissioned on the LMS Integration menu', async () => {
    const viewer = await actorWith(['lms.view']);
    expect((await request(app).get(`${API}/api-keys`).set(auth(viewer.token))).status).toBe(200);
    expect((await request(app).post(`${API}/api-keys`).set(auth(viewer.token)).send({ label: 'nope' })).status).toBe(403);
    const none = await actorWith(['imports.view']);
    expect((await request(app).get(`${API}/api-keys`).set(auth(none.token))).status).toBe(403);
    expect((await request(app).get(`${API}/api-keys`)).status).toBe(401);
  });
});

describe('X-Api-Key verification', () => {
  it('refuses missing, wrong, revoked, expired and out-of-scope keys with 401 API_KEY_INVALID, and never logs the key', async () => {
    const admin = await superAdmin();
    const { key, secret } = await newKey(admin.token);
    const warn = jest.spyOn(logger, 'warn');
    const body = matchBody(lmsPerson());

    const missing = await request(app).post(`${LMS}/students/match`).send(body);
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('API_KEY_INVALID');
    const wrong = secret.slice(0, -2) + (secret.endsWith('AA') ? 'BB' : 'AA');
    for (const bad of ['nonsense', wrong, `amk_000000000000_${'x'.repeat(43)}`]) {
      const r = await call(bad).match(body);
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('API_KEY_INVALID');
    }

    const narrow = await newKey(admin.token, { label: 'match only', scopes: ['lms.students.match'] });
    expect((await call(narrow.secret).match(body)).status).toBe(200);
    expect((await call(narrow.secret).create(lmsPerson(), 'idem-scope-1')).status).toBe(401);

    await AppDataSource.query(`UPDATE "api_keys" SET "expiresAt" = now() - interval '1 minute' WHERE "id" = $1`, [narrow.key.id]);
    expect((await call(narrow.secret).match(body)).status).toBe(401);

    await request(app).post(`${API}/api-keys/${key.id}/revoke`).set(auth(admin.token)).send({ reason: 'leaked in test' });
    expect((await call(secret).match(body)).status).toBe(401);

    const logged = JSON.stringify(warn.mock.calls);
    expect(warn).toHaveBeenCalled();
    for (const k of [secret, narrow.secret, wrong]) expect(logged).not.toContain(k);
    expect(JSON.stringify(await auditRows())).not.toContain(secret);
    warn.mockRestore();
  });

  it('records the last use', async () => {
    const admin = await superAdmin();
    const { key, secret } = await newKey(admin.token);
    await call(secret).match(matchBody(lmsPerson()));
    const [row] = await AppDataSource.query(`SELECT "lastUsedAt" FROM "api_keys" WHERE "id" = $1`, [key.id]);
    expect(row.lastUsedAt).not.toBeNull();
  });
});

describe('LMS student endpoints', () => {
  let secret: string;
  beforeEach(async () => {
    secret = (await newKey((await superAdmin()).token)).secret;
  });

  it('create → 201 CREATED with source LMS and code LMS-000001; the same Idempotency-Key replays; the same learner never duplicates', async () => {
    const p = lmsPerson({ aadhaar_number: aadhaar(), course_centre: 'PUN', technology: 'Cyber Security' });
    const first = await call(secret).create(p, 'lms-req-0001');
    expect(first.status).toBe(201);
    expect(first.body).toEqual({
      result: 'CREATED',
      student_id: expect.any(String),
      student_code: expect.stringMatching(/^LMS-[0-9]{6}$/),
    });

    const again = await call(secret).create(p, 'lms-req-0001');
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    /* Same learner, new key (LMS retry after a crash with a fresh id): the same student. */
    const sameLearner = await call(secret).create(p, 'lms-req-0002');
    expect(sameLearner.body.student_id).toBe(first.body.student_id);
    /* Same key, different body: refused. */
    const reused = await call(secret).create({ ...p, landmark: 'Changed' }, 'lms-req-0001');
    expect(reused.status).toBe(422);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const students = await AppDataSource.getRepository(Student).find();
    expect(students).toHaveLength(1);
    expect(students[0]).toMatchObject({
      code: first.body.student_code,
      source: 'LMS',
      status: 'RECEIVED',
      externalStatus: 'LMS',
      mobile: `+91${p.mobile_number as string}`,
      email: p.email,
      trackCode: 'T07',
      gender: 'Female',
      pinCode: '411001',
    });
    expect(students[0].registrationNumber).toMatch(/^\d{16}$/);
    expect(students[0].aadhaarLast4).toBe((p.aadhaar_number as string).slice(-4));
    expect(JSON.stringify(await auditRows())).not.toContain(p.aadhaar_number as string);

    /* A second LMS person gets the next code. */
    const second = await call(secret).create(lmsPerson(), 'lms-req-0003');
    /* The sequence is not reset between tests: the next number, whatever the first was. */
    expect(Number(second.body.student_code.slice(4))).toBe(Number(first.body.student_code.slice(4)) + 1);
  });

  it('match: NONE, then MATCH (T0, T1) and POSSIBLE (T1 conflict, T2), T3 information only; never returns values', async () => {
    const number = aadhaar();
    const p = lmsPerson({ aadhaar_number: number, source_record_id: 'LMS-SRC-1' });
    expect((await call(secret).match(matchBody(p))).body).toEqual({ result: 'NONE', tier: null, student_id: null, student_code: null });
    const created = (await call(secret).create(p, 'lms-req-m1')).body;

    const t0 = await call(secret).match(matchBody(p));
    expect(t0.body).toEqual({ result: 'MATCH', tier: 'T0', student_id: created.student_id, student_code: created.student_code });
    expect(JSON.stringify(t0.body)).not.toContain(p.email as string);

    const t1 = await call(secret).match(
      matchBody({ ...p, source_record_id: null, email: 'other@example.invalid', mobile_number: '6999999999' }),
    );
    expect(t1.body).toMatchObject({ result: 'MATCH', tier: 'T1', student_id: created.student_id });

    const conflict = await call(secret).match(matchBody({ ...p, source_record_id: null, date_of_birth: '2001-01-01' }));
    expect(conflict.body).toMatchObject({ result: 'POSSIBLE', tier: 'T1', student_id: created.student_id });

    const t2 = await call(secret).match(matchBody({ ...p, source_record_id: null, aadhaar_number: null, email: 'other@example.invalid' }));
    expect(t2.body).toMatchObject({ result: 'POSSIBLE', tier: 'T2', student_id: created.student_id });

    const t3 = await call(secret).match(matchBody({ ...lmsPerson(), mobile_number: p.mobile_number }));
    expect(t3.body).toEqual({ result: 'NONE', tier: 'T3', student_id: null, student_code: null });

    const bad = await call(secret).match({ first_name: 'x' });
    expect(bad.status).toBe(400);
    expect(bad.body.details).toEqual(expect.arrayContaining([{ field: 'last_name', code: 'required' }]));
  });

  it('create of a known person: MATCHED (no new student) or REVIEW → Amrut decides same / different person', async () => {
    const admin = await superAdmin();
    const number = aadhaar();
    const p = lmsPerson({ aadhaar_number: number });
    const original = (await call(secret).create(p, 'lms-req-r1')).body;

    /* Same Aadhaar, same name + DOB, another LMS learner → MATCHED. */
    const matched = await call(secret).create({ ...p, lms_learner_ref: 'other-learner' }, 'lms-req-r2');
    expect(matched.status).toBe(200);
    expect(matched.body).toEqual({ result: 'MATCHED', student_id: original.student_id, student_code: original.student_code });

    /* Same name + DOB + mobile, no Aadhaar → T2 → REVIEW (202), nothing created. */
    const review = await call(secret).create(
      { ...p, aadhaar_number: undefined, email: 'another@example.invalid', lms_learner_ref: 'l-3' },
      'lms-req-r3',
    );
    expect(review.status).toBe(202);
    expect(review.body).toEqual({ result: 'REVIEW', student_id: expect.any(String) });
    expect(await AppDataSource.getRepository(Student).count()).toBe(1);
    expect(
      (
        await call(secret).create(
          { ...p, aadhaar_number: undefined, email: 'another@example.invalid', lms_learner_ref: 'l-3' },
          'lms-req-r3',
        )
      ).status,
    ).toBe(202);

    const list = await request(app).get(`${API}/lms-integration-reviews?status=PENDING`).set(auth(admin.token));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({
      id: review.body.student_id,
      match: { tier: 'T2', studentId: original.student_id, studentCode: original.student_code },
    });
    expect(list.body.data[0].mobile).toMatch(/^\+91XXXXXX\d{4}$/);

    /* HOLD keeps it pending; DIFFERENT_PERSON creates the student with the review id. */
    const hold = await request(app)
      .post(`${API}/lms-integration-reviews/${review.body.student_id}/decide`)
      .set(auth(admin.token))
      .send({ decision: 'HOLD', reason: 'checking' });
    expect(hold.body.data.status).toBe('PENDING');
    const viewer = await actorWith(['imports.view']);
    expect(
      (
        await request(app)
          .post(`${API}/lms-integration-reviews/${review.body.student_id}/decide`)
          .set(auth(viewer.token))
          .send({ decision: 'SAME_PERSON', reason: 'nope' })
      ).status,
    ).toBe(403);
    const diff = await request(app)
      .post(`${API}/lms-integration-reviews/${review.body.student_id}/decide`)
      .set(auth(admin.token))
      .send({ decision: 'DIFFERENT_PERSON', reason: 'twins' });
    expect(diff.status).toBe(200);
    expect(diff.body.data).toMatchObject({ status: 'DECIDED', decision: 'DIFFERENT_PERSON', studentId: review.body.student_id });
    expect(
      (
        await request(app)
          .post(`${API}/lms-integration-reviews/${review.body.student_id}/decide`)
          .set(auth(admin.token))
          .send({ decision: 'HOLD', reason: 'again' })
      ).status,
    ).toBe(409);
    const replay = await call(secret).create(
      { ...p, aadhaar_number: undefined, email: 'another@example.invalid', lms_learner_ref: 'l-3' },
      'lms-req-r3',
    );
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual({
      result: 'CREATED',
      student_id: review.body.student_id,
      student_code: expect.stringMatching(/^LMS-[0-9]{6}$/),
    });
    expect(replay.body.student_code).not.toBe(original.student_code);
    expect((await auditRows()).map((a) => a.action)).toContain('reconciliation.decided');

    /* Another T2 review (same name + DOB + email as the original only) decided SAME_PERSON: the retry answers MATCHED. */
    const r2 = await call(secret).create(
      { ...p, aadhaar_number: undefined, mobile_number: '6888888888', lms_learner_ref: 'l-4' },
      'lms-req-r4',
    );
    expect(r2.status).toBe(202);
    await request(app)
      .post(`${API}/lms-integration-reviews/${r2.body.student_id}/decide`)
      .set(auth(admin.token))
      .send({ decision: 'SAME_PERSON', reason: 'same' });
    const r2again = await call(secret).create(
      { ...p, aadhaar_number: undefined, mobile_number: '6888888888', lms_learner_ref: 'l-4' },
      'lms-req-r5',
    );
    expect(r2again.status).toBe(200);
    expect(r2again.body.student_id).toBe(original.student_id);
    expect(await AppDataSource.getRepository(Student).count()).toBe(2);
  });

  it('create refuses missing fields and keys with {field, code} only', async () => {
    const noKey = await call(secret).create(lmsPerson());
    expect(noKey.status).toBe(400);
    expect(noKey.body.details).toEqual([{ field: 'Idempotency-Key', code: 'required' }]);
    const p = lmsPerson({ gender: '', email: 'broken', lms_learner_ref: '' });
    const bad = await call(secret).create(p, 'lms-req-bad');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    expect(bad.body.details).toEqual(
      expect.arrayContaining([
        { field: 'gender', code: 'required' },
        { field: 'email', code: 'email_invalid' },
        { field: 'lms_learner_ref', code: 'required' },
      ]),
    );
    expect(JSON.stringify(bad.body)).not.toContain('broken');
    expect(await AppDataSource.getRepository(Student).count()).toBe(0);
  });

  it('patch updates the student, refuses protected fields, 404 unknown, 409 STALE; a no-change retry is UPDATED', async () => {
    const created = (await call(secret).create(lmsPerson(), 'lms-req-p1')).body;
    const now = () => new Date(Date.now() + 1000).toISOString();
    const ok = await call(secret).patch(created.student_id, {
      first_name: 'Corrected',
      mobile_number: '6111111111',
      source_updated_at: now(),
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ result: 'UPDATED' });
    const s = await AppDataSource.getRepository(Student).findOneByOrFail({ id: created.student_id });
    expect(s.firstName).toBe('Corrected');
    expect(s.mobile).toBe('+916111111111');
    expect(
      (await call(secret).patch(created.student_id, { first_name: 'Corrected', source_updated_at: '2000-01-01T00:00:00.000Z' })).status,
    ).toBe(200);

    const stale = await call(secret).patch(created.student_id, { last_name: 'Older', source_updated_at: '2000-01-01T00:00:00.000Z' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('STALE');

    const protectedField = await call(secret).patch(created.student_id, { aadhaar_number: aadhaar(), source_updated_at: now() });
    expect(protectedField.status).toBe(400);
    expect(protectedField.body.details).toEqual([{ field: 'aadhaar_number', code: 'not_allowed' }]);
    expect((await call(secret).patch(created.student_id, { email: 'bad', source_updated_at: now() })).body.details).toEqual([
      { field: 'email', code: 'email_invalid' },
    ]);
    expect((await call(secret).patch(created.student_id, { email: 'x@example.invalid' })).body.details).toEqual([
      { field: 'source_updated_at', code: 'required' },
    ]);
    expect((await call(secret).patch('00000000-0000-4000-8000-000000000000', { first_name: 'X', source_updated_at: now() })).status).toBe(
      404,
    );
    expect((await call(secret).patch('not-a-uuid', { first_name: 'X', source_updated_at: now() })).status).toBe(404);
    expect((await auditRows()).find((a) => a.action === 'lms_integration.student.updated')?.details).not.toContain('Corrected');
  });

  /* What lms-api's Amrut client accepts (src/shared/amrut/amrut-client.ts shape checks, contract §2–§4). */
  it('answers in the shapes lms-api’s client checks', async () => {
    const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
    const m = (await call(secret).match(matchBody(lmsPerson()))).body;
    expect(['NONE', 'MATCH', 'POSSIBLE']).toContain(m.result);
    expect(m).toHaveProperty('tier');
    const c = await call(secret).create(lmsPerson(), 'lms-shape-1');
    expect(c.status).toBe(201);
    expect(c.body.result).toBe('CREATED');
    expect(c.body.student_id).toMatch(ID_RE);
    expect(c.body.student_code).toMatch(ID_RE);
    const u = await call(secret).patch(c.body.student_id, {
      landmark: 'New landmark',
      source_updated_at: new Date(Date.now() + 1000).toISOString(),
    });
    expect(u.body.result).toBe('UPDATED');
    const unauth = await call('wrong').match({});
    expect(unauth.status).toBe(401);
  });
});
