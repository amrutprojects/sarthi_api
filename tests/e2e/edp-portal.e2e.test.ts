import fs from 'fs';
import bcrypt from 'bcrypt';
import type { Express } from 'express';
import { AppDataSource } from '../../src/config/database.config';
import { HTTP_STATUS } from '../../src/constants/api-response.constants';
import { Student } from '../../src/database/entities';
import { withVerhoeffDigit } from '../../src/modules/students/aadhaar';
import { storageRoot } from '../../src/modules/students/documents/document-storage';
import { StudentDocument } from '../../src/modules/students/documents/student-document.entity';
import { edpMailer } from '../../src/modules/students/edp/edp.mailer';
import { ROLE_CODES } from '../../src/modules/roles-permissions/role.constants';
import { API, createUser, login, request, resetData, setupTestApp, teardownTestApp } from '../helpers/test-app';

let app: Express;
let lastOtp = '';
let sent = 0;
beforeAll(async () => {
  app = await setupTestApp();
});
beforeEach(async () => {
  await resetData();
  fs.rmSync(storageRoot(), { recursive: true, force: true });
  sent = 0;
  jest.spyOn(edpMailer, 'sendOtp').mockImplementation(async (_to, _name, otp) => {
    lastOtp = otp;
    sent++;
  });
  resetLinks.length = 0;
  jest.spyOn(edpMailer, 'sendPasswordReset').mockImplementation(async (to, _name, link) => {
    resetLinks.push({ to, link });
  });
});
/* Password reset emails "sent" in the current test: recipient and link. */
const resetLinks: { to: string; link: string }[] = [];
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  fs.rmSync(storageRoot(), { recursive: true, force: true });
  await teardownTestApp();
});

const EDP = `${API}/edp`;
const PDF = Buffer.from('%PDF-1.4\n% test document\n%%EOF\n');
const PASSWORD = 'Edp-pass-123';
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
let seq = 0;

async function masterId(table: string, code: string): Promise<string> {
  const [row] = await AppDataSource.query(`SELECT "id" FROM "${table}" WHERE "code" = $1 OR "name" = $1`, [code]);
  return row.id;
}
/* The mandatory document types the portal asks for: the master's, without the two it does not use. */
const EXCLUDED = ['FITNESS', 'SELF_DECLARATION'];
const mandatoryCodes = async (): Promise<string[]> =>
  (await AppDataSource.query(`SELECT "code" FROM "document_types" WHERE "isMandatory" AND "isActive" AND NOT "isDelete"`))
    .map((r: { code: string }) => r.code)
    .filter((c: string) => !EXCLUDED.includes(c));

const signUp = (email: string, over: Record<string, unknown> = {}) =>
  request(app)
    .post(`${EDP}/auth/register`)
    .send({
      first_name: 'Kavya',
      last_name: 'Jadhav',
      email,
      mobile_number: '9765412345',
      password: PASSWORD,
      confirm_password: PASSWORD,
      ...over,
    });

async function verifiedToken(email = `kavya${++seq}@example.invalid`): Promise<string> {
  expect((await signUp(email)).status).toBe(HTTP_STATUS.CREATED);
  const res = await request(app).post(`${EDP}/auth/verify-otp`).send({ email, otp: lastOtp, password: PASSWORD });
  expect(res.status).toBe(HTTP_STATUS.OK);
  return res.body.data.token as string;
}

async function basic(over: Record<string, string> = {}) {
  const n = ++seq;
  return {
    first_name: 'Kavya',
    last_name: 'Jadhav',
    father_name: 'Suresh Jadhav',
    mother_name: 'Meena Jadhav',
    email: `kavya${n}@example.invalid`,
    date_of_birth: '2002-06-01',
    current_address: 'Kothrud, Pune',
    aadhaar_number: withVerhoeffDigit(`3456789${String(10000 + n).slice(-4)}`),
    mobile_number: `97654${String(10000 + n).slice(-5)}`,
    religion: 'हिंदू',
    caste_id: await masterId('castes', 'मराठी'),
    ...over,
  };
}
const main = async () => ({
  region_id: await masterId('regions', 'PUN'),
  technology: 'T03',
  education_id: await masterId('educations', 'B.Com'),
});

const step = (token: string, n: number, data: Record<string, string>, complete = true) =>
  request(app).put(`${EDP}/application/steps/${n}`).set(bearer(token)).send({ complete, data });

async function uploadAll(token: string, codes?: string[]) {
  const r = request(app).post(`${EDP}/application/documents`).set(bearer(token));
  for (const c of codes ?? (await mandatoryCodes())) r.attach(c, PDF, `${c.toLowerCase()}.pdf`);
  return r;
}
const BARCODES = { INCOME_EWS: '271234567890123456', DOMICILE: '281234567890123456' };
const submit = (token: string, barcodes: Record<string, string> = BARCODES) =>
  request(app).post(`${EDP}/application/submit`).set(bearer(token)).send({ declaration_accepted: true, barcodes });

/* A student signed in, with all three steps done and submitted. */
async function submitted() {
  const token = await verifiedToken();
  const b = await basic();
  expect((await step(token, 1, b)).status).toBe(HTTP_STATUS.OK);
  expect((await step(token, 2, await main())).status).toBe(HTTP_STATUS.OK);
  expect((await uploadAll(token)).status).toBe(HTTP_STATUS.OK);
  const res = await submit(token);
  expect(res.status).toBe(HTTP_STATUS.CREATED);
  return { token, basic: b, result: res.body.data as { registration_id: string; registration_number: string } };
}

async function amrutAdminToken(): Promise<string> {
  const user = await createUser({ roleCodes: [ROLE_CODES.SUMAGO_SUPER_ADMIN] });
  return login(user.email);
}

describe('EDP account: sign-up with an emailed OTP', () => {
  it('emails a 6-digit OTP naming the programme, rejects a wrong one, verifies the right one and signs the student in', async () => {
    const email = 'Asha.Patil@Example.invalid';
    const res = await signUp(email, { middle_name: 'Ramesh' });
    expect(res.status).toBe(HTTP_STATUS.CREATED);
    /* Valid 5 minutes; a new one can be asked for only once it has expired. */
    expect(res.body.data).toEqual({ email: 'asha.patil@example.invalid', otp_expires_in: 300, resend_after: 300 });
    expect(edpMailer.sendOtp).toHaveBeenCalledWith('asha.patil@example.invalid', 'Kavya', expect.stringMatching(/^\d{6}$/), 300);
    const [stored] = await AppDataSource.query(
      `SELECT extract(epoch FROM "otpExpiresAt" - "otpSentAt")::int AS "lifetime" FROM "edp_accounts" WHERE "email" = $1`,
      ['asha.patil@example.invalid'],
    );
    expect(stored.lifetime).toBe(300);

    /* Not verified yet: cannot log in, and the account is pending. */
    const early = await request(app).post(`${EDP}/auth/login`).send({ email, password: PASSWORD });
    expect(early.status).toBe(HTTP_STATUS.FORBIDDEN);
    expect(early.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const wrong = await request(app)
      .post(`${EDP}/auth/verify-otp`)
      .send({ email, otp: lastOtp === '000000' ? '111111' : '000000', password: PASSWORD });
    expect(wrong.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(wrong.body.message).toBe('Incorrect OTP');
    expect(wrong.body.error.code).toBe('OTP_INCORRECT');

    const ok = await request(app).post(`${EDP}/auth/verify-otp`).send({ email, otp: lastOtp, password: PASSWORD });
    expect(ok.status).toBe(HTTP_STATUS.OK);
    expect(ok.body.data.account).toMatchObject({
      first_name: 'Kavya',
      middle_name: 'Ramesh',
      email: 'asha.patil@example.invalid',
      email_verified: true,
    });
    const me = await request(app).get(`${EDP}/me`).set(bearer(ok.body.data.token));
    expect(me.status).toBe(HTTP_STATUS.OK);

    /* The code works once; the account is now created, so signing up again with this email is refused. */
    expect((await request(app).post(`${EDP}/auth/verify-otp`).send({ email, otp: lastOtp, password: PASSWORD })).status).toBe(HTTP_STATUS.CONFLICT);
    expect((await signUp(email)).status).toBe(HTTP_STATUS.CONFLICT);

    const login = await request(app).post(`${EDP}/auth/login`).send({ email, password: PASSWORD });
    expect(login.status).toBe(HTTP_STATUS.OK);
    expect((await request(app).post(`${EDP}/auth/login`).send({ email, password: 'Wrong-pass-1' })).status).toBe(HTTP_STATUS.UNAUTHORIZED);

    /* Only an HMAC of the code was stored, and it is gone after verification. */
    const [row] = await AppDataSource.query(`SELECT "otpHash", "passwordHash" FROM "edp_accounts" WHERE "email" = $1`, [
      'asha.patil@example.invalid',
    ]);
    expect(row.otpHash).toBeNull();
    expect(await bcrypt.compare(PASSWORD, row.passwordHash)).toBe(true);
  });

  it('keeps the OTP valid for 5 minutes, and expires it after that', async () => {
    const email = 'expire@example.invalid';
    await signUp(email);
    const first = lastOtp;
    /* 4 minutes 50 seconds later: still valid. */
    await AppDataSource.query(
      `UPDATE "edp_accounts" SET "otpExpiresAt" = now() + interval '10 seconds', "otpSentAt" = now() - interval '290 seconds' WHERE "email" = $1`,
      [email],
    );
    const other = 'later@example.invalid';
    await signUp(other);
    await AppDataSource.query(
      `UPDATE "edp_accounts" SET "otpExpiresAt" = now() - interval '1 second', "otpSentAt" = now() - interval '301 seconds' WHERE "email" = $1`,
      [other],
    );
    /* 5 minutes and 1 second later: expired. */
    const expired = await request(app).post(`${EDP}/auth/verify-otp`).send({ email: other, otp: lastOtp, password: PASSWORD });
    expect(expired.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(expired.body.error.code).toBe('OTP_EXPIRED');
    expect(expired.body.message).toMatch(/expired/i);
    expect((await request(app).post(`${EDP}/auth/verify-otp`).send({ email, otp: first, password: PASSWORD })).status).toBe(HTTP_STATUS.OK);
  });

  it('allows a new OTP (Resend) only once the last one has expired (5 minutes); the new one replaces it', async () => {
    const email = 'resend@example.invalid';
    await signUp(email);
    const first = lastOtp;
    const tooSoon = await request(app).post(`${EDP}/auth/resend-otp`).send({ email });
    expect(tooSoon.status).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
    expect(tooSoon.body.error.code).toBe('OTP_RESEND_TOO_SOON');
    expect(tooSoon.body.message).toMatch(/^Please wait (5 min|4 min \d+ s) before requesting a new OTP\.$/);

    /* 4 minutes 50 seconds later the code is still valid, so no new one yet (nor by signing in or signing up again). */
    await AppDataSource.query(
      `UPDATE "edp_accounts" SET "otpSentAt" = now() - interval '290 seconds', "otpExpiresAt" = now() + interval '10 seconds' WHERE "email" = $1`,
      [email],
    );
    const stillValid = await request(app).post(`${EDP}/auth/resend-otp`).send({ email });
    expect(stillValid.status).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
    /* About 10 seconds (the database's clock may differ from this process's by a moment). */
    const wait = /^Please wait (\d+) seconds before requesting a new OTP\.$/.exec(stillValid.body.message);
    expect(Number(wait?.[1])).toBeGreaterThanOrEqual(5);
    expect(Number(wait?.[1])).toBeLessThanOrEqual(15);
    expect((await request(app).post(`${EDP}/auth/login`).send({ email, password: PASSWORD })).body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect((await signUp(email)).body.data).toMatchObject({ otp_expires_in: expect.any(Number), resend_after: expect.any(Number) });
    expect(sent).toBe(1);

    /* 5 minutes later the code has expired: it is refused as expired, and a new one can be asked for. */
    await AppDataSource.query(
      `UPDATE "edp_accounts" SET "otpSentAt" = now() - interval '310 seconds', "otpExpiresAt" = now() - interval '10 seconds' WHERE "email" = $1`,
      [email],
    );
    expect((await request(app).post(`${EDP}/auth/verify-otp`).send({ email, otp: first, password: PASSWORD })).body.error.code).toBe('OTP_EXPIRED');
    const resend = await request(app).post(`${EDP}/auth/resend-otp`).send({ email });
    expect(resend.status).toBe(HTTP_STATUS.OK);
    expect(resend.body.data).toMatchObject({ otp_expires_in: 300, resend_after: 300 });
    expect(sent).toBe(2);
    /* Only the newest code works. */
    if (first !== lastOtp)
      expect((await request(app).post(`${EDP}/auth/verify-otp`).send({ email, otp: first, password: PASSWORD })).body.error.code).toBe('OTP_INCORRECT');
    expect((await request(app).post(`${EDP}/auth/verify-otp`).send({ email, otp: lastOtp, password: PASSWORD })).status).toBe(HTTP_STATUS.OK);
  });

  it('stops after five wrong codes until a new one is requested', async () => {
    const email = 'guess@example.invalid';
    await signUp(email);
    const bad = lastOtp === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++)
      expect((await request(app).post(`${EDP}/auth/verify-otp`).send({ email, otp: bad, password: PASSWORD })).body.error.code).toBe('OTP_INCORRECT');
    const locked = await request(app).post(`${EDP}/auth/verify-otp`).send({ email, otp: lastOtp, password: PASSWORD });
    expect(locked.status).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
    expect(locked.body.error.code).toBe('OTP_TOO_MANY_ATTEMPTS');
    expect(locked.body.message).toBe('Too many incorrect attempts. Please request a new OTP when the current one expires.');

    /* Once the code has expired it says so (not "too many attempts"), and a new code works again. */
    await AppDataSource.query(
      `UPDATE "edp_accounts" SET "otpSentAt" = now() - interval '310 seconds', "otpExpiresAt" = now() - interval '10 seconds' WHERE "email" = $1`,
      [email],
    );
    expect((await request(app).post(`${EDP}/auth/verify-otp`).send({ email, otp: lastOtp, password: PASSWORD })).body.error.code).toBe('OTP_EXPIRED');
    expect((await request(app).post(`${EDP}/auth/resend-otp`).send({ email })).status).toBe(HTTP_STATUS.OK);
    expect((await request(app).post(`${EDP}/auth/verify-otp`).send({ email, otp: lastOtp, password: PASSWORD })).status).toBe(HTTP_STATUS.OK);
  });

  it("tells the OTP page the server's timing (after a reload or a login it cannot know when the OTP was sent)", async () => {
    const email = 'status@example.invalid';
    await signUp(email);
    await AppDataSource.query(
      `UPDATE "edp_accounts" SET "otpSentAt" = now() - interval '240 seconds', "otpExpiresAt" = now() + interval '60 seconds' WHERE "email" = $1`,
      [email],
    );
    const status = await request(app).post(`${EDP}/auth/otp-status`).send({ email });
    expect(status.status).toBe(HTTP_STATUS.OK);
    expect(status.body.data.email).toBe(email);
    for (const k of ['otp_expires_in', 'resend_after']) {
      expect(status.body.data[k]).toBeGreaterThanOrEqual(55);
      expect(status.body.data[k]).toBeLessThanOrEqual(65);
    }
    /* Expired: both 0 (a new OTP can be asked for now). */
    await AppDataSource.query(
      `UPDATE "edp_accounts" SET "otpSentAt" = now() - interval '310 seconds', "otpExpiresAt" = now() - interval '10 seconds' WHERE "email" = $1`,
      [email],
    );
    expect((await request(app).post(`${EDP}/auth/otp-status`).send({ email })).body.data).toEqual({ email, otp_expires_in: 0, resend_after: 0 });
    expect((await request(app).post(`${EDP}/auth/otp-status`).send({ email: 'nobody@example.invalid' })).status).toBe(HTTP_STATUS.NOT_FOUND);
    await request(app).post(`${EDP}/auth/resend-otp`).send({ email });
    await request(app).post(`${EDP}/auth/verify-otp`).send({ email, otp: lastOtp, password: PASSWORD });
    expect((await request(app).post(`${EDP}/auth/otp-status`).send({ email })).status).toBe(HTTP_STATUS.CONFLICT);
  });

  it('needs the password chosen at sign-up with the OTP, so a sign-up by someone else cannot take the account over', async () => {
    const verify = (email: string, otp: string, password: string) =>
      request(app).post(`${EDP}/auth/verify-otp`).send({ email, otp, password });

    /* Someone signs up first with the student's email and their own password; the OTP goes to the student's inbox. */
    const email = 'twice@example.invalid';
    await signUp(email, { first_name: 'Other', password: 'Other-pass-9', confirm_password: 'Other-pass-9' });
    const otp = lastOtp;
    /* The student signs up with the same email: their details and password replace the pending ones (no new email). */
    const again = await signUp(email, { first_name: 'Owner' });
    expect(again.status).toBe(HTTP_STATUS.CREATED);
    expect(again.body.data.otp_expires_in).toBeGreaterThan(0);
    expect(sent).toBe(1);
    /* The OTP with the other password does nothing (and counts as a wrong attempt); with the student's, it verifies. */
    const mismatch = await verify(email, otp, 'Other-pass-9');
    expect(mismatch.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(mismatch.body.error.code).toBe('SIGNUP_PASSWORD_MISMATCH');
    expect(mismatch.body.message).toBe(
      'This is not the password chosen when the account was created. Enter that password, or create the account again.',
    );
    const ok = await verify(email, otp, PASSWORD);
    expect(ok.status).toBe(HTTP_STATUS.OK);
    expect(ok.body.data.account.first_name).toBe('Owner');
    expect((await request(app).post(`${EDP}/auth/login`).send({ email, password: 'Other-pass-9' })).status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect((await request(app).post(`${EDP}/auth/login`).send({ email, password: PASSWORD })).status).toBe(HTTP_STATUS.OK);

    /* The other order: the student signs up, someone replaces the password; the student's OTP + password then fails. */
    const second = 'second@example.invalid';
    await signUp(second);
    const code = lastOtp;
    await signUp(second, { password: 'Other-pass-9', confirm_password: 'Other-pass-9' });
    expect((await verify(second, code, PASSWORD)).body.error.code).toBe('SIGNUP_PASSWORD_MISMATCH');
    /* Signing up again puts the student's password back, and the OTP in their inbox then works. */
    await signUp(second);
    expect((await verify(second, code, PASSWORD)).status).toBe(HTTP_STATUS.OK);
  });

  it('a sign-up whose OTP has expired is replaced by a new sign-up, with a new OTP', async () => {
    const late = 'late@example.invalid';
    await signUp(late, { first_name: 'Early' });
    await AppDataSource.query(
      `UPDATE "edp_accounts" SET "otpSentAt" = now() - interval '310 seconds', "otpExpiresAt" = now() - interval '10 seconds' WHERE "email" = $1`,
      [late],
    );
    const replaced = await signUp(late, { first_name: 'Later', password: 'Later-pass-9', confirm_password: 'Later-pass-9' });
    expect(replaced.body.data).toMatchObject({ otp_expires_in: 300, resend_after: 300 });
    expect(sent).toBe(2);
    const ok = await request(app).post(`${EDP}/auth/verify-otp`).send({ email: late, otp: lastOtp, password: 'Later-pass-9' });
    expect(ok.body.data.account.first_name).toBe('Later');
  });

  it('validates the sign-up form', async () => {
    const res = await signUp('not-an-email', { first_name: '', mobile_number: '12345', password: 'short', confirm_password: 'other' });
    expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['body.first_name', 'body.email', 'body.mobile_number', 'body.password']));
    const mismatch = await signUp('mm@example.invalid', { confirm_password: 'Different-123' });
    expect(mismatch.body.error.details).toEqual([{ field: 'body.confirm_password', message: 'Passwords do not match' }]);
    expect(sent).toBe(0);
  });
});

describe('EDP tokens are separate from the Amrut admin panel', () => {
  it('a portal token opens no admin endpoint, and an admin session opens no portal endpoint', async () => {
    const student = await verifiedToken();
    expect((await request(app).get(`${API}/student-registrations`).set(bearer(student))).status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect((await request(app).get(`${API}/users`).set(bearer(student))).status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect((await request(app).get(`${EDP}/manage/applicants`).set(bearer(student))).status).toBe(HTTP_STATUS.UNAUTHORIZED);
    const admin = await amrutAdminToken();
    expect((await request(app).get(`${EDP}/application`).set(bearer(admin))).status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect((await request(app).get(`${EDP}/manage/summary`).set(bearer(admin))).status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect((await request(app).get(`${EDP}/application`)).status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });
});

describe('EDP options', () => {
  it('lists only active master values', async () => {
    const casteId = await masterId('castes', 'मराठी');
    const before = await request(app).get(`${EDP}/options`);
    expect(before.status).toBe(HTTP_STATUS.OK);
    expect(before.body.data.castes.map((c: { id: string }) => c.id)).toContain(casteId);
    expect(before.body.data.tracks).toHaveLength(12);
    expect(before.body.data.document_types.find((d: { code: string }) => d.code === 'INCOME_EWS')).toMatchObject({ barcode: 'required' });
    /* The contact for queries, from EDP_SUPPORT_EMAIL / EDP_SUPPORT_MOBILE (tests/helpers/set-env.ts). */
    expect(before.body.data.support).toEqual({ email: 'edp.help@example.invalid', mobile: '+91 80000 00000' });

    await AppDataSource.query(`UPDATE "castes" SET "isActive" = false WHERE "id" = $1`, [casteId]);
    try {
      const after = await request(app).get(`${EDP}/options`);
      expect(after.body.data.castes.map((c: { id: string }) => c.id)).not.toContain(casteId);
      /* …and an inactive value is refused in the form. */
      const token = await verifiedToken();
      const res = await step(token, 1, await basic({ caste_id: casteId }));
      expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
      expect(res.body.error.details).toEqual([{ field: 'body.caste_id', message: 'Caste not found or inactive' }]);
    } finally {
      await AppDataSource.query(`UPDATE "castes" SET "isActive" = true WHERE "id" = $1`, [casteId]);
    }
  });
});

describe('EDP form: three steps, saved for resuming', () => {
  it('starts with the account details, keeps what was typed, and resumes at the step reached', async () => {
    const token = await verifiedToken('resume@example.invalid');
    const start = await request(app).get(`${EDP}/application`).set(bearer(token));
    expect(start.body.data).toMatchObject({ status: 'DRAFT', current_step: 1, editable: true });
    expect(start.body.data.form).toMatchObject({
      first_name: 'Kavya',
      last_name: 'Jadhav',
      email: 'resume@example.invalid',
      mobile_number: '9765412345',
    });

    /* Half-filled step 1, then "network loss": nothing is checked yet, everything is kept (Aadhaar encrypted). */
    const b = await basic();
    expect((await step(token, 1, { father_name: b.father_name, aadhaar_number: b.aadhaar_number }, false)).status).toBe(HTTP_STATUS.OK);
    const [raw] = await AppDataSource.query(`SELECT "data", "aadhaarEnc" FROM "edp_applications"`);
    expect(raw.data.aadhaar_number).toBeUndefined();
    expect(raw.aadhaarEnc).not.toBeNull();
    const resumed = await request(app).get(`${EDP}/application`).set(bearer(token));
    expect(resumed.body.data.form).toMatchObject({ father_name: 'Suresh Jadhav', aadhaar_number: b.aadhaar_number });

    /* Step 2 needs step 1. Step 1 is checked like the admin form. */
    expect((await step(token, 2, await main())).status).toBe(HTTP_STATUS.CONFLICT);
    const invalid = await step(token, 1, { ...b, date_of_birth: '2030-01-01', aadhaar_number: '123412341234' });
    expect(invalid.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(invalid.body.error.details.map((d: { field: string }) => d.field)).toEqual(
      expect.arrayContaining(['body.date_of_birth', 'body.aadhaar_number']),
    );
    const one = await step(token, 1, b);
    expect(one.status).toBe(HTTP_STATUS.OK);
    expect(one.body.data).toMatchObject({ current_step: 2, steps: { basic_completed: true, main_completed: false } });
    const two = await step(token, 2, await main());
    expect(two.body.data).toMatchObject({ current_step: 3, steps: { basic_completed: true, main_completed: true } });

    /* Log out and in again: the same place. */
    const again = await request(app).post(`${EDP}/auth/login`).send({ email: 'resume@example.invalid', password: PASSWORD });
    const back = await request(app).get(`${EDP}/application`).set(bearer(again.body.data.token));
    expect(back.body.data).toMatchObject({ current_step: 3, form: { father_name: 'Suresh Jadhav', technology: 'T03' } });
  });

  it('refuses an Aadhaar number that is already registered', async () => {
    const { basic: b } = await submitted();
    const other = await verifiedToken();
    const res = await step(other, 1, await basic({ aadhaar_number: b.aadhaar_number }));
    expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(res.body.error.details).toEqual([
      { field: 'body.aadhaar_number', message: 'A registration with this Aadhaar number already exists' },
    ]);
  });

  it('needs every mandatory document, and the required barcodes, before submitting', async () => {
    const token = await verifiedToken();
    await step(token, 1, await basic());
    await step(token, 2, await main());
    const codes = await mandatoryCodes();
    expect(
      (
        await uploadAll(
          token,
          codes.filter((c) => c !== 'PHOTO'),
        )
      ).status,
    ).toBe(HTTP_STATUS.OK);
    const res = await submit(token, {});
    expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        { field: 'files.PHOTO', message: expect.stringMatching(/required/) },
        { field: 'body.barcodes.INCOME_EWS', message: expect.stringMatching(/barcode is required/) },
      ]),
    );
    /* A file that is not a PDF/JPG/PNG is refused. */
    const bad = await request(app)
      .post(`${EDP}/application/documents`)
      .set(bearer(token))
      .attach('PHOTO', Buffer.from('hello'), 'photo.pdf');
    expect(bad.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(await AppDataSource.getRepository(Student).count()).toBe(0);
  });
});

describe('EDP submission reaches the Amrut admin panel', () => {
  it('creates the registration with its documents, shown in Student Registrations; a second submit is refused', async () => {
    const { token, basic: b, result } = await submitted();
    expect(result.registration_id).toMatch(/^REG-\d{6}$/);
    expect(result.registration_number).toMatch(/^\d{16}$/);

    const student = await AppDataSource.getRepository(Student).findOneByOrFail({ code: result.registration_id });
    expect(student).toMatchObject({
      firstName: 'Kavya',
      fatherName: 'Suresh Jadhav',
      status: 'REGISTRATION_PENDING',
      source: 'PUBLIC_REGISTRATION',
      trackCode: 'T03',
    });
    expect(student.documents.INCOME_EWS).toMatchObject({ supplied: true, barcode: BARCODES.INCOME_EWS });
    const files = await AppDataSource.getRepository(StudentDocument).find({ where: { studentId: student.id } });
    expect(files.map((f) => f.docType).sort()).toEqual((await mandatoryCodes()).sort());
    /* Recorded as uploaded by the portal's system user, which cannot sign in. */
    const [uploader] = await AppDataSource.query(`SELECT "email", "isActive" FROM "users" WHERE "id" = $1`, [files[0]!.uploadedById]);
    expect(uploader).toEqual({ email: 'edp-portal@system.local', isActive: false });

    const admin = await amrutAdminToken();
    const list = await request(app).get(`${API}/student-registrations`).query({ search: result.registration_id }).set(bearer(admin));
    expect(list.body.data.map((r: { id: string }) => r.id)).toEqual([student.id]);

    const view = await request(app).get(`${EDP}/application`).set(bearer(token));
    expect(view.body.data).toMatchObject({
      status: 'SUBMITTED',
      editable: false,
      registration: { registration_id: result.registration_id, aadhaar_masked: `XXXX-XXXX-${b.aadhaar_number.slice(-4)}` },
    });
    /* No edit option of any kind. */
    expect(view.body.data).not.toHaveProperty('can_edit');
    expect(view.body.data).not.toHaveProperty('edit_used');
    expect(view.body.data.form.aadhaar_number).toBe('');
    expect(view.body.data.submitted_files).toHaveLength((await mandatoryCodes()).length);
    /* The draft files are gone from the portal's own storage. */
    expect(await AppDataSource.query(`SELECT 1 FROM "edp_application_files"`)).toHaveLength(0);
    const file = await request(app).get(`${EDP}/application/documents/PHOTO/file`).set(bearer(token));
    expect(file.status).toBe(HTTP_STATUS.OK);
    expect(file.headers['content-type']).toBe('application/pdf');

    expect((await submit(token)).status).toBe(HTTP_STATUS.CONFLICT);
    expect((await step(token, 1, b)).status).toBe(HTTP_STATUS.CONFLICT);
  });

  it("shows the Amrut admin panel's later edits on the student's page", async () => {
    const { token, basic: b, result } = await submitted();
    const admin = await amrutAdminToken();
    const student = await AppDataSource.getRepository(Student).findOneByOrFail({ code: result.registration_id });
    const { first_name, last_name, mother_name, email, date_of_birth, current_address, aadhaar_number, mobile_number, religion, caste_id } =
      b;
    const patch = await request(app)
      .patch(`${API}/student-registrations/${student.id}`)
      .set(bearer(admin))
      .send({
        first_name,
        last_name,
        father_name: 'Suresh Rao Jadhav',
        mother_name,
        email,
        date_of_birth,
        current_address,
        aadhaar_number,
        mobile_number,
        religion,
        caste_id,
        ...(await main()),
      });
    expect(patch.status).toBe(HTTP_STATUS.OK);
    const view = await request(app).get(`${EDP}/application`).set(bearer(token));
    expect(view.body.data.form.father_name).toBe('Suresh Rao Jadhav');
  });
});

describe('Documents the portal does not use (Physical Fitness Certificate, Self-Declaration Form)', () => {
  it('are not offered, are refused on upload, are not required, and are not shown even when the record holds one', async () => {
    const options = await request(app).get(`${EDP}/options`);
    const codes = options.body.data.document_types.map((d: { code: string }) => d.code);
    expect(codes).not.toEqual(expect.arrayContaining(['FITNESS']));
    expect(codes).not.toContain('SELF_DECLARATION');
    expect(JSON.stringify(options.body)).not.toMatch(/Fitness|Self-Declaration/i);
    /* Still in the master for the AMRUT admin panel. */
    expect(await mandatoryCodes()).not.toContain('FITNESS');
    expect(
      (await AppDataSource.query(`SELECT "code" FROM "document_types" WHERE "code" IN ('FITNESS','SELF_DECLARATION') AND "isActive"`))
        .length,
    ).toBe(2);

    const token = await verifiedToken();
    const refused = await request(app).post(`${EDP}/application/documents`).set(bearer(token)).attach('FITNESS', PDF, 'fitness.pdf');
    expect(refused.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(refused.body.error.details).toEqual([{ field: 'files.FITNESS', message: 'Unknown or inactive document type' }]);

    /* Submitted without them (submitted() uploads only the portal's mandatory types). */
    const { token: done, result } = await submitted();
    const student = await AppDataSource.getRepository(Student).findOneByOrFail({ code: result.registration_id });
    const stored = await AppDataSource.getRepository(StudentDocument).find({ where: { studentId: student.id } });
    expect(stored.map((f) => f.docType)).not.toEqual(expect.arrayContaining(['FITNESS']));
    expect(stored.map((f) => f.docType)).not.toContain('SELF_DECLARATION');

    /* A file of that type added to the record elsewhere (e.g. the admin panel) is not shown or served by the portal. */
    await AppDataSource.getRepository(StudentDocument).insert({
      ...stored[0]!,
      id: undefined,
      docType: 'FITNESS',
      originalName: 'fitness.pdf',
      createdAt: undefined,
      updatedAt: undefined,
    } as unknown as StudentDocument);
    const view = await request(app).get(`${EDP}/application`).set(bearer(done));
    expect(view.body.data.submitted_files.map((f: { doc_type: string }) => f.doc_type)).not.toContain('FITNESS');
    expect((await request(app).get(`${EDP}/application/documents/FITNESS/file`).set(bearer(done))).status).toBe(HTTP_STATUS.NOT_FOUND);
  });
});

describe('A submission is final', () => {
  it('offers no edit or resubmission, and refuses every change after submitting', async () => {
    const { token, basic: b, result } = await submitted();
    /* The former edit endpoints no longer exist. */
    for (const path of ['/application/edit', '/application/edit/cancel', '/application/resubmit'])
      expect((await request(app).post(`${EDP}${path}`).set(bearer(token)).send({ declaration_accepted: true })).status).toBe(
        HTTP_STATUS.NOT_FOUND,
      );

    const refused = async (res: { status: number; body: { error: { code: string }; message: string } }) => {
      expect(res.status).toBe(HTTP_STATUS.CONFLICT);
      expect(res.body.error.code).toBe('ALREADY_SUBMITTED');
      expect(res.body.message).toBe('Your form has already been submitted. A submitted form cannot be changed.');
    };
    await refused(await step(token, 1, { ...b, father_name: 'Someone Else' }));
    await refused(await step(token, 1, { father_name: 'Someone Else' }, false));
    await refused(await step(token, 3, { INCOME_EWS: '111111111111111111' }, false));
    await refused(await request(app).post(`${EDP}/application/documents`).set(bearer(token)).attach('PHOTO', PDF, 'photo2.pdf'));
    await refused(await request(app).delete(`${EDP}/application/documents/PHOTO`).set(bearer(token)));
    await refused(await submit(token));

    /* Nothing changed in the student register. */
    const student = await AppDataSource.getRepository(Student).findOneByOrFail({ code: result.registration_id });
    expect(student.fatherName).toBe(b.father_name);
    expect(await AppDataSource.getRepository(Student).count()).toBe(1);
    const view = await request(app).get(`${EDP}/application`).set(bearer(token));
    expect(view.body.data).toMatchObject({ status: 'SUBMITTED', editable: false });
  });

  it('only DRAFT and SUBMITTED exist (the database refuses the former edit states)', async () => {
    const { token } = await submitted();
    await expect(AppDataSource.query(`UPDATE "edp_applications" SET "status" = 'EDITING'`)).rejects.toThrow(/CHK_edp_applications_status/);
    expect((await request(app).get(`${EDP}/application`).set(bearer(token))).body.data.status).toBe('SUBMITTED');
  });
});

describe('EDP tracking panel (/manage)', () => {
  it('signs in a seeded EDP admin and tracks every student by stage', async () => {
    await AppDataSource.query(
      `INSERT INTO "edp_admins" ("name", "email", "passwordHash") VALUES ('EDP Admin', 'edp.admin@example.invalid', $1)`,
      [await bcrypt.hash('Manage-pass-123', 4)],
    );
    /* One student per stage: OTP pending, verified, step 1 done, submitted. */
    await signUp('pending@example.invalid');
    await verifiedToken('verified@example.invalid');
    const s1 = await verifiedToken('stepone@example.invalid');
    await step(s1, 1, await basic());
    await submitted();

    expect(
      (await request(app).post(`${EDP}/manage/auth/login`).send({ email: 'edp.admin@example.invalid', password: 'wrong-pass' })).status,
    ).toBe(HTTP_STATUS.UNAUTHORIZED);
    const login = await request(app)
      .post(`${EDP}/manage/auth/login`)
      .send({ email: 'EDP.Admin@example.invalid', password: 'Manage-pass-123' });
    expect(login.status).toBe(HTTP_STATUS.OK);
    const token = login.body.data.token as string;

    const summary = await request(app).get(`${EDP}/manage/summary`).set(bearer(token));
    expect(summary.body.data.total).toBe(4);
    expect(summary.body.data.counts).toMatchObject({ OTP_PENDING: 1, VERIFIED: 1, BASIC_DONE: 1, SUBMITTED: 1, MAIN_DONE: 0 });

    const abandoned = await request(app).get(`${EDP}/manage/applicants`).query({ stage: 'BASIC_DONE' }).set(bearer(token));
    expect(abandoned.body.data).toEqual([
      expect.objectContaining({
        email: 'stepone@example.invalid',
        stage: 'BASIC_DONE',
        stage_label: 'Step 1 filled (Basic Details)',
        submitted_at: null,
      }),
    ]);
    const done = await request(app).get(`${EDP}/manage/applicants`).query({ stage: 'SUBMITTED' }).set(bearer(token));
    expect(done.body.data[0]).toMatchObject({ registration_id: expect.stringMatching(/^REG-/), submitted_at: expect.any(String) });
    const search = await request(app).get(`${EDP}/manage/applicants`).query({ search: 'pending@' }).set(bearer(token));
    expect(search.body.data.map((r: { stage: string }) => r.stage)).toEqual(['OTP_PENDING']);
    expect(search.body.meta).toMatchObject({ total: 1 });

    /* The tracking panel token opens nothing else. */
    expect((await request(app).get(`${EDP}/application`).set(bearer(token))).status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect((await request(app).get(`${API}/student-registrations`).set(bearer(token))).status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });
});

describe('EDP tracking panel follow-ups', () => {
  async function manageToken(): Promise<string> {
    await AppDataSource.query(
      `INSERT INTO "edp_admins" ("name", "email", "passwordHash") VALUES ('Follow Admin', 'follow.admin@example.invalid', $1)`,
      [await bcrypt.hash('Manage-pass-123', 4)],
    );
    const res = await request(app)
      .post(`${EDP}/manage/auth/login`)
      .send({ email: 'follow.admin@example.invalid', password: 'Manage-pass-123' });
    return res.body.data.token as string;
  }
  const accountId = async (email: string) =>
    ((await AppDataSource.query(`SELECT "id" FROM "edp_accounts" WHERE "email" = $1`, [email])) as { id: string }[])[0]!.id;

  it('records follow-ups with a status and a note; the latest shows in the list and can be filtered on', async () => {
    const token = await manageToken();
    await signUp('call.me@example.invalid');
    await signUp('other@example.invalid');
    const id = await accountId('call.me@example.invalid');
    const url = `${EDP}/manage/applicants/${id}/follow-ups`;

    const first = await request(app)
      .post(url)
      .set(bearer(token))
      .send({ status: 'CALLED', note: '  Did not pick up; call again tomorrow  ' });
    expect(first.status).toBe(HTTP_STATUS.CREATED);
    expect(first.body.data).toEqual([
      expect.objectContaining({
        status: 'CALLED',
        status_label: 'Follow-up call',
        note: 'Did not pick up; call again tomorrow',
        by: 'Follow Admin',
      }),
    ]);
    const second = await request(app).post(url).set(bearer(token)).send({ status: 'SECOND_CALL' });
    expect(second.body.data.map((f: { status: string; note: string | null }) => [f.status, f.note])).toEqual([
      ['SECOND_CALL', null],
      ['CALLED', 'Did not pick up; call again tomorrow'],
    ]);
    expect((await request(app).get(url).set(bearer(token))).body.data).toHaveLength(2);

    /* The list shows each student's latest follow-up; null when there is none. */
    const list = await request(app).get(`${EDP}/manage/applicants`).set(bearer(token));
    const byEmail = Object.fromEntries(list.body.data.map((r: { email: string; follow_up: unknown }) => [r.email, r.follow_up]));
    expect(byEmail['call.me@example.invalid']).toMatchObject({ status: 'SECOND_CALL', status_label: 'Second follow-up', note: null });
    expect(byEmail['other@example.invalid']).toBeNull();

    const called = await request(app).get(`${EDP}/manage/applicants`).query({ follow_up: 'SECOND_CALL' }).set(bearer(token));
    expect(called.body.data.map((r: { email: string }) => r.email)).toEqual(['call.me@example.invalid']);
    const none = await request(app).get(`${EDP}/manage/applicants`).query({ follow_up: 'NONE' }).set(bearer(token));
    expect(none.body.data.map((r: { email: string }) => r.email)).toEqual(['other@example.invalid']);
    const summary = await request(app).get(`${EDP}/manage/summary`).set(bearer(token));
    expect(summary.body.data.follow_ups).toMatchObject({ NONE: 1, SECOND_CALL: 1, CALLED: 0, PENDING: 0, FORM_FILLED: 0 });

    /* A recorded follow-up is audited without its note. */
    const [audit] = await AppDataSource.query(
      `SELECT "details" FROM "audit_logs" WHERE "action" = 'edp.follow_up.create' ORDER BY "createdAt" LIMIT 1`,
    );
    expect(audit.details).toMatchObject({ status: 'CALLED', hasNote: true });
    expect(JSON.stringify(audit.details)).not.toContain('pick up');
  });

  it('validates the status and the note, and refuses unknown students and portal tokens', async () => {
    const token = await manageToken();
    await signUp('val@example.invalid');
    const url = `${EDP}/manage/applicants/${await accountId('val@example.invalid')}/follow-ups`;
    const bad = await request(app)
      .post(url)
      .set(bearer(token))
      .send({ status: 'MAYBE', note: 'x'.repeat(1001) });
    expect(bad.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(bad.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual(['body.note', 'body.status']);
    const missing = `${EDP}/manage/applicants/00000000-0000-4000-8000-000000000000/follow-ups`;
    expect((await request(app).post(missing).set(bearer(token)).send({ status: 'PENDING' })).status).toBe(HTTP_STATUS.NOT_FOUND);
    const student = await verifiedToken();
    expect((await request(app).post(url).set(bearer(student)).send({ status: 'PENDING' })).status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect((await request(app).get(url)).status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(
      (
        await request(app)
          .get(url)
          .set(bearer(await amrutAdminToken()))
      ).status,
    ).toBe(HTTP_STATUS.UNAUTHORIZED);

    /* A NUL in the note is a 422 naming the field, not a database error. */
    const nul = await request(app).post(url).set(bearer(token)).send({ status: 'CALLED', note: 'a\u0000b' });
    expect(nul.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(nul.body.error.details).toEqual([{ field: 'body.note', message: 'Note contains characters that cannot be saved' }]);
    /* Line breaks are fine; a blank note is stored as none. */
    const ok = await request(app).post(url).set(bearer(token)).send({ status: 'CALLED', note: 'line one\nline two' });
    expect(ok.body.data[0].note).toBe('line one\nline two');
    const blank = await request(app).post(url).set(bearer(token)).send({ status: 'PENDING', note: '   ' });
    expect(blank.body.data[0]).toMatchObject({ status: 'PENDING', note: null });
  });

  it('keeps the history when the admin who recorded it is removed, and hides deleted students', async () => {
    const token = await manageToken();
    await signUp('history@example.invalid');
    const id = await accountId('history@example.invalid');
    const url = `${EDP}/manage/applicants/${id}/follow-ups`;
    await request(app).post(url).set(bearer(token)).send({ status: 'FORM_FILLED', note: 'Done' });

    /* Another admin reads it after the first one has been removed: the follow-up stays, without a name. */
    await AppDataSource.query(`DELETE FROM "edp_admins" WHERE "email" = 'follow.admin@example.invalid'`);
    await AppDataSource.query(
      `INSERT INTO "edp_admins" ("name", "email", "passwordHash") VALUES ('Second Admin', 'second.admin@example.invalid', $1)`,
      [await bcrypt.hash('Manage-pass-123', 4)],
    );
    const second = (
      await request(app).post(`${EDP}/manage/auth/login`).send({ email: 'second.admin@example.invalid', password: 'Manage-pass-123' })
    ).body.data.token as string;
    expect((await request(app).get(url).set(bearer(second))).body.data).toEqual([
      expect.objectContaining({ status: 'FORM_FILLED', note: 'Done', by: null }),
    ]);

    /* A soft-deleted student: not found, and no longer counted. */
    const before = (await request(app).get(`${EDP}/manage/summary`).set(bearer(second))).body.data.total as number;
    await AppDataSource.query(`UPDATE "edp_accounts" SET "isDelete" = true WHERE "id" = $1`, [id]);
    expect((await request(app).get(url).set(bearer(second))).status).toBe(HTTP_STATUS.NOT_FOUND);
    expect((await request(app).post(url).set(bearer(second)).send({ status: 'PENDING' })).status).toBe(HTTP_STATUS.NOT_FOUND);
    expect((await request(app).get(`${EDP}/manage/summary`).set(bearer(second))).body.data.total).toBe(before - 1);
  });
});

describe("The form's email is the account's (read-only)", () => {
  it('ignores any other email sent with the form, and registers the account email', async () => {
    const token = await verifiedToken('owner@example.invalid');
    expect((await request(app).get(`${EDP}/application`).set(bearer(token))).body.data.form.email).toBe('owner@example.invalid');
    await step(token, 1, { email: 'typed@example.invalid' }, false);
    expect((await request(app).get(`${EDP}/application`).set(bearer(token))).body.data.form.email).toBe('owner@example.invalid');

    const one = await step(token, 1, await basic({ email: 'someone.else@example.invalid' }));
    expect(one.status).toBe(HTTP_STATUS.OK);
    expect(one.body.data.form.email).toBe('owner@example.invalid');
    await step(token, 2, await main());
    await uploadAll(token);
    const res = await submit(token);
    expect(res.status).toBe(HTTP_STATUS.CREATED);
    const student = await AppDataSource.getRepository(Student).findOneByOrFail({ code: res.body.data.registration_id });
    expect(student.email).toBe('owner@example.invalid');
  });

  it('after submission shows the registration email, including a correction by the programme office', async () => {
    const { token, result } = await submitted();
    await AppDataSource.query(`UPDATE "students" SET "email" = 'corrected@example.invalid' WHERE "code" = $1`, [result.registration_id]);
    expect((await request(app).get(`${EDP}/application`).set(bearer(token))).body.data.form.email).toBe('corrected@example.invalid');
  });
});

describe('EDP forgot password', () => {
  const forgot = (email: string) => request(app).post(`${EDP}/auth/forgot-password`).send({ email });
  const tokenOf = (link: string) => new URL(link).searchParams.get('token') ?? '';
  const reset = (token: string, password = 'New-pass-456', confirm = password) =>
    request(app).post(`${EDP}/auth/reset-password`).send({ token, password, confirm_password: confirm });

  it('emails a one-time link to the portal; the new password then works and the old one does not', async () => {
    const email = `kavya${++seq}@example.invalid`;
    const oldSession = await (async () => {
      expect((await signUp(email)).status).toBe(HTTP_STATUS.CREATED);
      return (await request(app).post(`${EDP}/auth/verify-otp`).send({ email, otp: lastOtp, password: PASSWORD })).body.data.token as string;
    })();

    const res = await forgot(email.toUpperCase());
    expect(res.status).toBe(HTTP_STATUS.OK);
    expect(res.body.message).toBe('A password reset link has been sent to your email ID. The link is valid for 30 minutes.');
    expect(res.body.data).toEqual({ email, link_valid_minutes: 30, resend_after: 60 });
    expect(resetLinks).toHaveLength(1);
    expect(resetLinks[0].to).toBe(email);
    /* EDP_PORTAL_URL (default outside production: the local portal), never the request's Host. */
    expect(resetLinks[0].link).toMatch(/^http:\/\/localhost:5175\/reset-password\?token=[A-Za-z0-9_-]{43}$/);
    const token = tokenOf(resetLinks[0].link);
    /* Only an HMAC of the token is stored. */
    const [row] = await AppDataSource.query(`SELECT "resetTokenHash" FROM "edp_accounts" WHERE "email" = $1`, [email]);
    expect(row.resetTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.resetTokenHash).not.toContain(token);

    expect((await request(app).post(`${EDP}/auth/reset-password/check`).send({ token })).body.data).toEqual({ email });
    /* The sign-up's password rules. */
    const weak = await reset(token, 'short');
    expect(weak.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(weak.body.error.details.map((d: { field: string }) => d.field)).toContain('body.password');
    expect((await reset(token, 'New-pass-456', 'New-pass-457')).body.error.details).toEqual([
      { field: 'body.confirm_password', message: 'Passwords do not match' },
    ]);

    const done = await reset(token);
    expect(done.status).toBe(HTTP_STATUS.OK);
    expect(done.body.message).toBe('Your password has been changed. Please log in with your new password.');
    expect(done.body.data).toEqual({ email });

    expect((await request(app).post(`${EDP}/auth/login`).send({ email, password: PASSWORD })).status).toBe(HTTP_STATUS.UNAUTHORIZED);
    const login = await request(app).post(`${EDP}/auth/login`).send({ email, password: 'New-pass-456' });
    expect(login.status).toBe(HTTP_STATUS.OK);
    expect((await request(app).get(`${EDP}/me`).set(bearer(login.body.data.token))).status).toBe(HTTP_STATUS.OK);
    /* Sessions signed in before the change are signed out. */
    const old = await request(app).get(`${EDP}/me`).set(bearer(oldSession));
    expect(old.status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(old.body.message).toBe('Your password was changed. Please log in again.');

    /* The link works once. */
    const reused = await reset(token, 'Third-pass-789');
    expect(reused.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(reused.body.error.code).toBe('RESET_LINK_INVALID');
    expect((await request(app).post(`${EDP}/auth/reset-password/check`).send({ token })).body.error.code).toBe('RESET_LINK_INVALID');
  });

  it('says when the email ID is not registered, and sends nothing', async () => {
    const res = await forgot('nobody-here@example.invalid');
    expect(res.status).toBe(HTTP_STATUS.NOT_FOUND);
    expect(res.body.error.code).toBe('EMAIL_NOT_REGISTERED');
    expect(res.body.message).toBe('This email ID is not registered. Kindly check your email ID.');
    expect(resetLinks).toHaveLength(0);
  });

  it('expires a link after 30 minutes, and a newer link replaces the earlier one', async () => {
    const email = `kavya${++seq}@example.invalid`;
    await verifiedToken(email);
    await forgot(email);
    const first = tokenOf(resetLinks[0].link);
    /* Asked again within a minute: no second email (told to check the email), and the first link still works. */
    const tooSoon = await forgot(email);
    expect(tooSoon.status).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
    expect(tooSoon.body.error.code).toBe('RESET_TOO_SOON');
    expect(tooSoon.body.message).toMatch(
      /^A password reset link was just sent to this email ID\. Please check your email, or try again in (\d+ seconds|1 min)\.$/,
    );
    expect(resetLinks).toHaveLength(1);
    expect((await request(app).post(`${EDP}/auth/reset-password/check`).send({ token: first })).status).toBe(HTTP_STATUS.OK);

    await AppDataSource.query(`UPDATE "edp_accounts" SET "resetSentAt" = now() - interval '61 seconds' WHERE "email" = $1`, [email]);
    await forgot(email);
    expect(resetLinks).toHaveLength(2);
    const second = tokenOf(resetLinks[1].link);
    expect((await reset(first)).body.error.code).toBe('RESET_LINK_INVALID');

    await AppDataSource.query(`UPDATE "edp_accounts" SET "resetExpiresAt" = now() - interval '10 seconds' WHERE "email" = $1`, [email]);
    const expired = await reset(second);
    expect(expired.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(expired.body.error.code).toBe('RESET_LINK_EXPIRED');
    expect(expired.body.message).toBe('This password reset link has expired. Please request a new link.');
    expect((await request(app).post(`${EDP}/auth/login`).send({ email, password: PASSWORD })).status).toBe(HTTP_STATUS.OK);
  });

  it('sends at most 5 links an hour to one account', async () => {
    const email = `kavya${++seq}@example.invalid`;
    await verifiedToken(email);
    for (let i = 0; i < 7; i++) {
      await AppDataSource.query(`UPDATE "edp_accounts" SET "resetSentAt" = now() - interval '61 seconds' WHERE "email" = $1`, [email]);
      const res = await forgot(email);
      if (i < 5) expect(res.status).toBe(HTTP_STATUS.OK);
      else {
        expect(res.status).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
        expect(res.body.message).toBe('Too many password reset requests for this email ID. Please try again after an hour.');
      }
    }
    expect(resetLinks).toHaveLength(5);
  });

  it('does not count emails that could not be sent toward the hourly limit', async () => {
    const email = `kavya${++seq}@example.invalid`;
    await verifiedToken(email);
    const send = jest.spyOn(edpMailer, 'sendPasswordReset');
    for (let i = 0; i < 6; i++) {
      send.mockRejectedValueOnce(new Error('SMTP unavailable'));
      expect((await forgot(email)).status).not.toBe(HTTP_STATUS.OK);
    }
    const [row] = await AppDataSource.query(`SELECT "resetSendCount", "resetTokenHash" FROM "edp_accounts" WHERE "email" = $1`, [email]);
    expect(row).toEqual({ resetSendCount: 0, resetTokenHash: null });
    expect((await forgot(email)).status).toBe(HTTP_STATUS.OK);
    expect(resetLinks).toHaveLength(1);
  });

  it('refuses an unknown link, and a disabled account', async () => {
    const unknown = await request(app).post(`${EDP}/auth/reset-password/check`).send({ token: 'x'.repeat(43) });
    expect(unknown.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(unknown.body.message).toBe('This password reset link is not valid or has already been used. Please request a new link.');

    const email = `kavya${++seq}@example.invalid`;
    await verifiedToken(email);
    await forgot(email);
    await AppDataSource.query(`UPDATE "edp_accounts" SET "isActive" = false WHERE "email" = $1`, [email]);
    expect((await reset(tokenOf(resetLinks[0].link))).body.error.code).toBe('RESET_LINK_INVALID');
    const disabled = await forgot(email);
    expect(disabled.status).toBe(HTTP_STATUS.FORBIDDEN);
    expect(disabled.body.message).toBe('This account has been disabled. Please contact the programme office.');
    expect(resetLinks).toHaveLength(1);
  });

  it('verifies the email of an account that never entered its sign-up OTP (the link reached that email)', async () => {
    const email = 'unverified-reset@example.invalid';
    await signUp(email);
    await forgot(email);
    expect((await reset(tokenOf(resetLinks[0].link))).status).toBe(HTTP_STATUS.OK);
    const login = await request(app).post(`${EDP}/auth/login`).send({ email, password: 'New-pass-456' });
    expect(login.status).toBe(HTTP_STATUS.OK);
    expect(login.body.data.account.email_verified).toBe(true);
    expect((await request(app).get(`${EDP}/application`).set(bearer(login.body.data.token))).status).toBe(HTTP_STATUS.OK);
  });
});
