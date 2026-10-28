import fs from 'fs';
import yauzl from 'yauzl';
import path from 'path';
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
import { actorWith, API, createUser, login, request, resetData, setupTestApp, teardownTestApp } from '../helpers/test-app';

let app: Express;
let lastOtp = '';
let sent = 0;
beforeAll(async () => {
  app = await setupTestApp();
});
/* Geography, a centre offering one technology (T03) and one offering none, recreated after every reset. */
const fx = {
  stateId: '',
  districtId: '',
  talukaId: '',
  otherTalukaId: '',
  centreId: '',
  emptyCentreId: '',
};
const insertId = async (sql: string, args: unknown[] = []) => ((await AppDataSource.query(sql, args)) as { id: string }[])[0].id;
async function edpFixtures() {
  fx.stateId = await insertId(`INSERT INTO "states" ("name", "code") VALUES ('Maharashtra', 'MH') RETURNING "id"`);
  fx.districtId = await insertId(`INSERT INTO "districts" ("stateId", "name", "code") VALUES ($1, 'Pune', 'PUNE') RETURNING "id"`, [
    fx.stateId,
  ]);
  const nashik = await insertId(`INSERT INTO "districts" ("stateId", "name", "code") VALUES ($1, 'Nashik', 'NASHIK') RETURNING "id"`, [
    fx.stateId,
  ]);
  fx.talukaId = await insertId(`INSERT INTO "talukas" ("districtId", "name", "code") VALUES ($1, 'Haveli', 'HAV') RETURNING "id"`, [
    fx.districtId,
  ]);
  fx.otherTalukaId = await insertId(`INSERT INTO "talukas" ("districtId", "name", "code") VALUES ($1, 'Niphad', 'NIP') RETURNING "id"`, [
    nashik,
  ]);
  fx.centreId = await insertId(
    `INSERT INTO "edp_centres" ("name", "code", "districtId") VALUES ('Pune EDP Centre', 'PUN-EDP', $1) RETURNING "id"`,
    [fx.districtId],
  );
  fx.emptyCentreId = await insertId(
    `INSERT INTO "edp_centres" ("name", "code", "districtId") VALUES ('Empty Centre', 'EMPTY', $1) RETURNING "id"`,
    [fx.districtId],
  );
  await AppDataSource.query(
    `INSERT INTO "edp_centre_technologies" ("centreId", "technologyTrackId") SELECT $1, "id" FROM "technology_tracks" WHERE "code" = 'T03'`,
    [fx.centreId],
  );
}

beforeEach(async () => {
  await resetData();
  await edpFixtures();
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
/* The start of an MP4 file: an "ftyp" box (size 24, brand isom). */
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(16)]);
const PASSWORD = 'Edp-pass-123';
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
let seq = 0;

async function masterId(table: string, code: string): Promise<string> {
  const [row] = await AppDataSource.query(`SELECT "id" FROM "${table}" WHERE "code" = $1 OR "name" = $1`, [code]);
  return row.id;
}
/* The document types the portal requires (its own list, EDP_DOCUMENTS): all but the optional Applicant Video. */
const REQUIRED_DOCS = [
  'PHOTO',
  'SIGNATURE',
  'AADHAAR_CARD',
  'AADHAAR_PHOTO',
  'PAN_CARD',
  'HSC_DIPLOMA',
  'EDU_CERT',
  'INCOME_EWS',
  'SCHOOL_LEAVING',
  'DOMICILE',
];
const mandatoryCodes = async (): Promise<string[]> => [...REQUIRED_DOCS];

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
    gender: 'Female',
    marital_status: 'Unmarried',
    permanent_address: 'Kothrud, Pune',
    landmark: 'Near the bus stand',
    district_id: fx.districtId,
    taluka_id: fx.talukaId,
    pin_code: '411038',
    alternate_mobile_number: '',
    alternate_email: '',
    disability_status: 'No',
    disability_type: '',
    disability_certificate_number: '',
    ...over,
  };
}
const main = async (over: Record<string, string> = {}) => ({
  region_id: await masterId('regions', 'PUN'),
  technology: 'T03',
  education_id: await masterId('educations', 'B.Com'),
  centre_id: fx.centreId,
  qualification_name: 'Bachelor of Commerce',
  qualification_stream: 'Commerce',
  qualification_board: 'Savitribai Phule Pune University',
  qualification_completed_on: '2023-05-31',
  grading_type: 'PERCENTAGE',
  cgpa_scale: '',
  score: '72.5',
  qualification_class: 'First Class',
  ...over,
});

const step = (token: string, n: number, data: Record<string, string>, complete = true) =>
  request(app).put(`${EDP}/application/steps/${n}`).set(bearer(token)).send({ complete, data });

async function uploadAll(token: string, codes?: string[]) {
  const r = request(app).post(`${EDP}/application/documents`).set(bearer(token));
  for (const c of codes ?? (await mandatoryCodes()))
    if (c === 'APPLICANT_VIDEO') r.attach(c, MP4, 'video.mp4');
    else r.attach(c, PDF, `${c.toLowerCase()}.pdf`);
  return r;
}
/* The portal asks for no certificate barcodes; a submission sends only the declaration. */
const submit = (token: string) => request(app).post(`${EDP}/application/submit`).set(bearer(token)).send({ declaration_accepted: true });

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
    expect((await request(app).post(`${EDP}/auth/verify-otp`).send({ email, otp: lastOtp, password: PASSWORD })).status).toBe(
      HTTP_STATUS.CONFLICT,
    );
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
    expect((await request(app).post(`${EDP}/auth/verify-otp`).send({ email, otp: first, password: PASSWORD })).body.error.code).toBe(
      'OTP_EXPIRED',
    );
    const resend = await request(app).post(`${EDP}/auth/resend-otp`).send({ email });
    expect(resend.status).toBe(HTTP_STATUS.OK);
    expect(resend.body.data).toMatchObject({ otp_expires_in: 300, resend_after: 300 });
    expect(sent).toBe(2);
    /* Only the newest code works. */
    if (first !== lastOtp)
      expect((await request(app).post(`${EDP}/auth/verify-otp`).send({ email, otp: first, password: PASSWORD })).body.error.code).toBe(
        'OTP_INCORRECT',
      );
    expect((await request(app).post(`${EDP}/auth/verify-otp`).send({ email, otp: lastOtp, password: PASSWORD })).status).toBe(
      HTTP_STATUS.OK,
    );
  });

  it('stops after five wrong codes until a new one is requested', async () => {
    const email = 'guess@example.invalid';
    await signUp(email);
    const bad = lastOtp === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++)
      expect((await request(app).post(`${EDP}/auth/verify-otp`).send({ email, otp: bad, password: PASSWORD })).body.error.code).toBe(
        'OTP_INCORRECT',
      );
    const locked = await request(app).post(`${EDP}/auth/verify-otp`).send({ email, otp: lastOtp, password: PASSWORD });
    expect(locked.status).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
    expect(locked.body.error.code).toBe('OTP_TOO_MANY_ATTEMPTS');
    expect(locked.body.message).toBe('Too many incorrect attempts. Please request a new OTP when the current one expires.');

    /* Once the code has expired it says so (not "too many attempts"), and a new code works again. */
    await AppDataSource.query(
      `UPDATE "edp_accounts" SET "otpSentAt" = now() - interval '310 seconds', "otpExpiresAt" = now() - interval '10 seconds' WHERE "email" = $1`,
      [email],
    );
    expect((await request(app).post(`${EDP}/auth/verify-otp`).send({ email, otp: lastOtp, password: PASSWORD })).body.error.code).toBe(
      'OTP_EXPIRED',
    );
    expect((await request(app).post(`${EDP}/auth/resend-otp`).send({ email })).status).toBe(HTTP_STATUS.OK);
    expect((await request(app).post(`${EDP}/auth/verify-otp`).send({ email, otp: lastOtp, password: PASSWORD })).status).toBe(
      HTTP_STATUS.OK,
    );
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
    expect((await request(app).post(`${EDP}/auth/otp-status`).send({ email })).body.data).toEqual({
      email,
      otp_expires_in: 0,
      resend_after: 0,
    });
    expect((await request(app).post(`${EDP}/auth/otp-status`).send({ email: 'nobody@example.invalid' })).status).toBe(
      HTTP_STATUS.NOT_FOUND,
    );
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
    /* No barcode is asked for, not even for the EWS and domicile certificates. */
    expect(before.body.data.document_types.every((d: { barcode: string | null }) => d.barcode === null)).toBe(true);
    /* The contact for queries: until it is edited in the tracking panel, the standard message and EDP_SUPPORT_EMAIL / EDP_SUPPORT_MOBILE (tests/helpers/set-env.ts). */
    expect(before.body.data.support).toEqual({
      message: 'If you have any query related to your registration, you can contact us on email ID {email} or mobile number {mobile}.',
      email: 'edp.help@example.invalid',
      mobile: '+91 80000 00000',
    });

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

  it('needs every mandatory document before submitting, and no certificate barcode', async () => {
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
    const res = await submit(token);
    expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(res.body.error.details).toEqual([{ field: 'files.PHOTO', message: 'Photo is required' }]);
    /* A file that is not a PDF/JPG/PNG is refused. */
    const bad = await request(app)
      .post(`${EDP}/application/documents`)
      .set(bearer(token))
      .attach('PHOTO', Buffer.from('hello'), 'photo.pdf');
    expect(bad.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(await AppDataSource.getRepository(Student).count()).toBe(0);
  });
});

describe('EDP submission stays in the EDP system', () => {
  it('creates the EDP registration with its documents in the candidate folder, not in Student Registrations; a second submit is refused', async () => {
    const { token, basic: b, result } = await submitted();
    expect(result.registration_id).toMatch(/^EDP-\d{6}$/);
    expect(result.registration_number).toMatch(/^\d{16}$/);

    /* Nothing reaches the Amrut admin panel's student register. */
    expect(await AppDataSource.getRepository(Student).count()).toBe(0);
    expect(await AppDataSource.getRepository(StudentDocument).count()).toBe(0);
    const admin = await amrutAdminToken();
    const list = await request(app).get(`${API}/student-registrations`).query({ search: result.registration_id }).set(bearer(admin));
    expect(list.body.data).toEqual([]);

    /* The application is the record: its form data, the Aadhaar (blind index, last four) and its files are kept. */
    const [p] = await AppDataSource.query(
      `SELECT "status", "registrationCode", "registrationNumber", "studentId", "aadhaarLast4", "data" FROM "edp_applications"`,
    );
    expect(p).toMatchObject({
      status: 'SUBMITTED',
      registrationCode: result.registration_id,
      registrationNumber: result.registration_number,
      studentId: null,
      aadhaarLast4: b.aadhaar_number.slice(-4),
    });
    expect(p.data).toMatchObject({ first_name: 'Kavya', father_name: 'Suresh Jadhav', technology: 'T03', centre_id: fx.centreId });
    expect(p.data.aadhaar_number).toBeUndefined();

    /* One folder per candidate: edp/candidates/<registration ID>_<name>/<DOCUMENT>.<ext>. */
    const folder = `edp/candidates/${result.registration_id}_Kavya_Jadhav`;
    const files: { docType: string; storageKey: string }[] = await AppDataSource.query(
      `SELECT "docType", "storageKey" FROM "edp_application_files"`,
    );
    expect(files.map((x) => x.docType).sort()).toEqual((await mandatoryCodes()).sort());
    for (const x of files) {
      expect(x.storageKey).toBe(`${folder}/${x.docType}.pdf`);
      expect(fs.existsSync(path.join(storageRoot(), x.storageKey))).toBe(true);
    }

    const view = await request(app).get(`${EDP}/application`).set(bearer(token));
    expect(view.body.data).toMatchObject({
      status: 'SUBMITTED',
      editable: false,
      registration: {
        registration_id: result.registration_id,
        registration_number: result.registration_number,
        status: 'SUBMITTED',
        aadhaar_masked: `XXXX-XXXX-${b.aadhaar_number.slice(-4)}`,
      },
    });
    expect(view.body.data.registration.display).toMatchObject({
      centre: 'Pune EDP Centre',
      district: 'Pune',
      technology: 'Web Design & Development',
    });
    expect(view.body.data).not.toHaveProperty('can_edit');
    expect(view.body.data.form.aadhaar_number).toBe('');
    expect(view.body.data.form.father_name).toBe('Suresh Jadhav');
    expect(view.body.data.submitted_files).toHaveLength((await mandatoryCodes()).length);
    expect(view.body.data.draft_files).toEqual([]);
    const file = await request(app).get(`${EDP}/application/documents/PHOTO/file`).set(bearer(token));
    expect(file.status).toBe(HTTP_STATUS.OK);
    expect(file.headers['content-type']).toBe('application/pdf');

    expect((await submit(token)).status).toBe(HTTP_STATUS.CONFLICT);
    expect((await step(token, 1, b)).status).toBe(HTTP_STATUS.CONFLICT);
  });

  it('gives each submission the next registration ID, and refuses a second EDP registration with the same Aadhaar', async () => {
    const one = await submitted();
    const two = await submitted();
    expect(Number(two.result.registration_id.slice(4))).toBe(Number(one.result.registration_id.slice(4)) + 1);
    expect(two.result.registration_number).not.toBe(one.result.registration_number);

    /* A draft that reached step 3 before the other was submitted: refused at submission (409), nothing is moved. */
    const token = await verifiedToken();
    const b = await basic();
    expect((await step(token, 1, b)).status).toBe(HTTP_STATUS.OK);
    expect((await step(token, 2, await main())).status).toBe(HTTP_STATUS.OK);
    expect((await uploadAll(token)).status).toBe(HTTP_STATUS.OK);
    const [draft] = await AppDataSource.query(`SELECT "id" FROM "edp_applications" WHERE "status" = 'DRAFT'`);
    const keysBefore = (
      await AppDataSource.query(`SELECT "storageKey" FROM "edp_application_files" WHERE "applicationId" = $1`, [draft.id])
    ).map((r: { storageKey: string }) => r.storageKey);
    await AppDataSource.query(
      `UPDATE "edp_applications" SET "aadhaarEnc" = (SELECT "aadhaarEnc" FROM "edp_applications" WHERE "registrationCode" = $1) WHERE "id" = $2`,
      [one.result.registration_id, draft.id],
    );
    const res = await submit(token);
    expect(res.status).toBe(HTTP_STATUS.CONFLICT);
    expect(res.body.message).toBe('A registration with this Aadhaar number already exists');
    const keysAfter = (
      await AppDataSource.query(`SELECT "storageKey" FROM "edp_application_files" WHERE "applicationId" = $1`, [draft.id])
    ).map((r: { storageKey: string }) => r.storageKey);
    expect(keysAfter.sort()).toEqual(keysBefore.sort());
    for (const k of keysAfter) expect(fs.existsSync(path.join(storageRoot(), k))).toBe(true);
  });
});

describe("Step 3 offers exactly the portal's document list", () => {
  it('lists the 11 documents in order with their labels and required rule; other types are refused, not required and not shown', async () => {
    const options = await request(app).get(`${EDP}/options`);
    const types = options.body.data.document_types as { code: string; name: string; is_mandatory: boolean }[];
    expect(types.map((t) => [t.code, t.name, t.is_mandatory])).toEqual([
      ['PHOTO', 'Photo', true],
      ['SIGNATURE', 'Signature', true],
      ['AADHAAR_CARD', 'Aadhar Card', true],
      ['AADHAAR_PHOTO', 'Applicant Photograph with Aadhaar', true],
      ['APPLICANT_VIDEO', 'Applicant Video with Aadhaar', false],
      ['PAN_CARD', 'PAN Card', true],
      ['HSC_DIPLOMA', '12th Pass Or 3 Years Diploma Pass Marksheet / Certificate', true],
      ['EDU_CERT', 'Highest Qualification Certificate / Marksheet', true],
      ['INCOME_EWS', 'EWS Certificate', true],
      ['SCHOOL_LEAVING', 'School Leaving Certificate / Transfer Certificate', true],
      ['DOMICILE', 'Domicile of Certificate Maharashtra', true],
    ]);
    /* The master keeps its own settings for the Amrut admin panel's form. */
    const [pan] = await AppDataSource.query(`SELECT "isMandatory" FROM "document_types" WHERE "code" = 'PAN_CARD'`);
    expect(pan.isMandatory).toBe(false);

    const token = await verifiedToken();
    for (const code of ['FITNESS', 'CASTE_CERT', 'NAME_CHANGE']) {
      const refused = await request(app).post(`${EDP}/application/documents`).set(bearer(token)).attach(code, PDF, 'x.pdf');
      expect(refused.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
      expect(refused.body.error.details).toEqual([{ field: `files.${code}`, message: 'Unknown or inactive document type' }]);
    }

    /* Submitted with the required ones only (Caste Certificate is mandatory in the master, not in the portal). */
    const { token: done } = await submitted();
    const stored: { applicationId: string; docType: string; storageKey: string }[] = await AppDataSource.query(
      `SELECT "applicationId", "docType", "storageKey" FROM "edp_application_files"`,
    );
    expect(stored.map((f) => f.docType).sort()).toEqual([...REQUIRED_DOCS].sort());

    /* A file of another type on the record (e.g. from an older version) is not shown or served by the portal. */
    await AppDataSource.query(
      `INSERT INTO "edp_application_files" ("applicationId", "docType", "storageKey", "originalName", "mimeType", "sizeBytes", "sha256")
       VALUES ($1, 'FITNESS', $2, 'fitness.pdf', 'application/pdf', 10, repeat('0', 64))`,
      [stored[0]!.applicationId, stored[0]!.storageKey],
    );
    const view = await request(app).get(`${EDP}/application`).set(bearer(done));
    expect(view.body.data.submitted_files.map((f: { doc_type: string }) => f.doc_type)).not.toContain('FITNESS');
    expect((await request(app).get(`${EDP}/application/documents/FITNESS/file`).set(bearer(done))).status).toBe(HTTP_STATUS.NOT_FOUND);
  });

  it('accepts only an MP4 (up to 50 MB) for the Applicant Video, and only PDF / JPG / PNG (up to 5 MB) for the others', async () => {
    const types = (await request(app).get(`${EDP}/options`)).body.data.document_types as {
      code: string;
      formats: string[];
      max_mb: number;
    }[];
    expect(types.find((t) => t.code === 'APPLICANT_VIDEO')).toMatchObject({ formats: ['MP4'], max_mb: 50 });
    expect(types.find((t) => t.code === 'PHOTO')).toMatchObject({ formats: ['PDF', 'JPG', 'JPEG', 'PNG'], max_mb: 5 });
    const token = await verifiedToken();
    const up = (code: string, data: Buffer, name: string) =>
      request(app).post(`${EDP}/application/documents`).set(bearer(token)).attach(code, data, name);
    /* A 6 MB video is fine; a 6 MB photo is not. */
    const bigVideo = Buffer.concat([MP4, Buffer.alloc(6 * 1024 * 1024)]);
    expect((await up('APPLICANT_VIDEO', bigVideo, 'aadhaar-video.mp4')).status).toBe(HTTP_STATUS.OK);
    const bigPhoto = await up('PHOTO', Buffer.concat([PDF, Buffer.alloc(6 * 1024 * 1024)]), 'photo.pdf');
    expect(bigPhoto.body.error.details).toEqual([{ field: 'files.PHOTO', message: 'Photo: file is larger than 5 MB' }]);
    /* The type follows the content and the name: a PDF is not a video, an MP4 is not a photo, a .mov is refused. */
    expect((await up('APPLICANT_VIDEO', PDF, 'video.pdf')).body.error.details).toEqual([
      { field: 'files.APPLICANT_VIDEO', message: 'Applicant Video with Aadhaar: only MP4 videos are accepted' },
    ]);
    expect((await up('PHOTO', MP4, 'photo.mp4')).status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect((await up('APPLICANT_VIDEO', MP4, 'video.mov')).status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    /* The uploaded video is kept as an MP4 and served back as one. */
    const draft = (await request(app).get(`${EDP}/application`).set(bearer(token))).body.data.draft_files as {
      doc_type: string;
      mime_type: string;
    }[];
    expect(draft).toEqual([expect.objectContaining({ doc_type: 'APPLICANT_VIDEO', mime_type: 'video/mp4' })]);
    const file = await request(app).get(`${EDP}/application/documents/APPLICANT_VIDEO/file`).set(bearer(token));
    expect(file.status).toBe(HTTP_STATUS.OK);
    expect(file.headers['content-type']).toMatch(/video\/mp4/);
  });

  it('needs a required document such as PAN Card, and accepts the optional Applicant Video', async () => {
    const token = await verifiedToken();
    expect((await step(token, 1, await basic())).status).toBe(HTTP_STATUS.OK);
    expect((await step(token, 2, await main())).status).toBe(HTTP_STATUS.OK);
    expect(
      (
        await uploadAll(
          token,
          REQUIRED_DOCS.filter((c) => c !== 'PAN_CARD'),
        )
      ).status,
    ).toBe(HTTP_STATUS.OK);
    const missing = await submit(token);
    expect(missing.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(missing.body.error.details).toEqual([{ field: 'files.PAN_CARD', message: 'PAN Card is required' }]);
    expect((await uploadAll(token, ['PAN_CARD', 'APPLICANT_VIDEO'])).status).toBe(HTTP_STATUS.OK);
    expect((await submit(token)).status).toBe(HTTP_STATUS.CREATED);
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

    /* Nothing changed on the submitted record. */
    const [p] = await AppDataSource.query(`SELECT "data", "registrationCode" FROM "edp_applications"`);
    expect(p).toMatchObject({ registrationCode: result.registration_id, data: expect.objectContaining({ father_name: b.father_name }) });
    expect(await AppDataSource.getRepository(Student).count()).toBe(0);
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
    expect(done.body.data[0]).toMatchObject({ registration_id: expect.stringMatching(/^EDP-\d{6}$/), submitted_at: expect.any(String) });
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
    expect([...new Set(bad.body.error.details.map((d: { field: string }) => d.field))].sort()).toEqual(['body.note', 'body.status']);
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
    const [p] = await AppDataSource.query(`SELECT "data" FROM "edp_applications" WHERE "registrationCode" = $1`, [
      res.body.data.registration_id,
    ]);
    expect(p.data.email).toBe('owner@example.invalid');
    expect((await request(app).get(`${EDP}/application`).set(bearer(token))).body.data.form.email).toBe('owner@example.invalid');
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
      return (await request(app).post(`${EDP}/auth/verify-otp`).send({ email, otp: lastOtp, password: PASSWORD })).body.data
        .token as string;
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
    const unknown = await request(app)
      .post(`${EDP}/auth/reset-password/check`)
      .send({ token: 'x'.repeat(43) });
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

type ErrorBody = { body: { error: { details: { field: string }[] } } };
const fieldsOf = (res: ErrorBody) => res.body.error.details.map((d) => d.field);

describe('EDP Basic Details: address, contact and disability rules', () => {
  it('checks the PIN code, the dependent taluka and optional alternate contacts', async () => {
    const token = await verifiedToken();
    const bad = await step(
      token,
      1,
      await basic({ pin_code: '41103', alternate_mobile_number: '12345', alternate_email: 'not-an-email', gender: 'X' }),
    );
    expect(bad.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(fieldsOf(bad)).toEqual(
      expect.arrayContaining(['body.pin_code', 'body.alternate_mobile_number', 'body.alternate_email', 'body.gender']),
    );
    /* A taluka of another district is refused. */
    const wrongTaluka = await step(token, 1, await basic({ taluka_id: fx.otherTalukaId }));
    expect(wrongTaluka.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(wrongTaluka.body.error.details).toEqual([{ field: 'body.taluka_id', message: 'Select a taluka of the selected district' }]);
    /* The alternate contacts are optional, but must differ from the primary ones. */
    const b = await basic();
    expect(fieldsOf(await step(token, 1, { ...b, alternate_mobile_number: b.mobile_number }))).toEqual(['body.alternate_mobile_number']);
    expect((await step(token, 1, b)).status).toBe(HTTP_STATUS.OK);
  });

  it('needs the disability details only when a disability is declared, and drops them otherwise', async () => {
    const token = await verifiedToken();
    const missing = await step(token, 1, await basic({ disability_status: 'Yes' }));
    expect(fieldsOf(missing)).toEqual(expect.arrayContaining(['body.disability_type', 'body.disability_certificate_number']));
    const yes = await step(
      token,
      1,
      await basic({ disability_status: 'Yes', disability_type: 'Low vision', disability_certificate_number: 'MH12/34-567' }),
    );
    expect(yes.status).toBe(HTTP_STATUS.OK);
    const no = await step(
      token,
      1,
      await basic({ disability_status: 'No', disability_type: 'Low vision', disability_certificate_number: 'X1234' }),
    );
    expect(no.status).toBe(HTTP_STATUS.OK);
    expect(no.body.data.form).toMatchObject({ disability_type: '', disability_certificate_number: '' });
  });

  it('lists the talukas of a district for the dependent dropdown', async () => {
    const res = await request(app).get(`${EDP}/districts/${fx.districtId}/talukas`);
    expect(res.status).toBe(HTTP_STATUS.OK);
    expect(res.body.data).toEqual([{ id: fx.talukaId, name: 'Haveli', code: 'HAV' }]);
  });
});

describe('EDP Main Form: centre, its technologies and qualification', () => {
  async function atStep2() {
    const token = await verifiedToken();
    expect((await step(token, 1, await basic())).status).toBe(HTTP_STATUS.OK);
    return token;
  }

  it('offers active centres and only the technologies allocated to the chosen centre', async () => {
    const options = await request(app).get(`${EDP}/options`);
    expect(options.body.data.centres.map((c: { id: string }) => c.id).sort()).toEqual([fx.centreId, fx.emptyCentreId].sort());
    expect(options.body.data).toMatchObject({ genders: expect.any(Array), grading_types: expect.any(Array), cgpa_scales: [4, 5, 10] });
    const technologies = await request(app).get(`${EDP}/centres/${fx.centreId}/technologies`);
    expect(technologies.body.data).toEqual([{ code: 'T03', name: 'Web Design & Development' }]);
    expect((await request(app).get(`${EDP}/centres/${fx.emptyCentreId}/technologies`)).body.data).toEqual([]);
    await AppDataSource.query(`UPDATE "edp_centres" SET "isActive" = false WHERE "id" = $1`, [fx.emptyCentreId]);
    expect((await request(app).get(`${EDP}/centres/${fx.emptyCentreId}/technologies`)).status).toBe(HTTP_STATUS.NOT_FOUND);
  });

  it('refuses a technology not offered at the centre, and an inactive centre, even when sent directly', async () => {
    const token = await atStep2();
    const notOffered = await step(token, 2, await main({ technology: 'T05' }));
    expect(notOffered.body.error.details).toEqual([
      { field: 'body.technology', message: 'This technology is not offered at the selected center' },
    ]);
    await AppDataSource.query(`UPDATE "edp_centres" SET "isActive" = false WHERE "id" = $1`, [fx.centreId]);
    const inactive = await step(token, 2, await main());
    expect(inactive.body.error.details).toEqual([{ field: 'body.centre_id', message: 'Center not found or inactive' }]);
  });

  it('validates the score by grading type, the CGPA scale and the completion date', async () => {
    const token = await atStep2();
    expect(fieldsOf(await step(token, 2, await main({ score: '100.5' })))).toEqual(['body.score']);
    expect(fieldsOf(await step(token, 2, await main({ score: '72.555' })))).toEqual(['body.score']);
    expect(fieldsOf(await step(token, 2, await main({ grading_type: 'CGPA', cgpa_scale: '', score: '8' })))).toEqual(['body.cgpa_scale']);
    expect(fieldsOf(await step(token, 2, await main({ grading_type: 'CGPA', cgpa_scale: '4', score: '4.5' })))).toEqual(['body.score']);
    expect(fieldsOf(await step(token, 2, await main({ qualification_completed_on: '2999-01-01' })))).toEqual([
      'body.qualification_completed_on',
    ]);
    const ok = await step(token, 2, await main({ grading_type: 'CGPA', cgpa_scale: '10', score: '8.25' }));
    expect(ok.status).toBe(HTTP_STATUS.OK);
    expect(ok.body.data.form).toMatchObject({
      grading_type: 'CGPA',
      cgpa_scale: '10',
      score: '8.25',
      qualification_name: 'Bachelor of Commerce',
    });
  });

  it('re-checks the centre at submission, and stores every detail on the registration', async () => {
    const token = await atStep2();
    expect((await step(token, 2, await main())).status).toBe(HTTP_STATUS.OK);
    expect((await uploadAll(token)).status).toBe(HTTP_STATUS.OK);
    /* The allocation is removed after step 2: the submission is refused and nothing is created. */
    await AppDataSource.query(`UPDATE "edp_centre_technologies" SET "isDelete" = true`);
    const refused = await submit(token);
    expect(refused.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(fieldsOf(refused)).toContain('body.technology');
    expect(await AppDataSource.query(`SELECT 1 FROM "edp_applications" WHERE "status" = 'SUBMITTED'`)).toHaveLength(0);
    await AppDataSource.query(`UPDATE "edp_centre_technologies" SET "isDelete" = false`);
    expect((await submit(token)).status).toBe(HTTP_STATUS.CREATED);
    const [p] = await AppDataSource.query(`SELECT "data" FROM "edp_applications" WHERE "status" = 'SUBMITTED'`);
    expect(p.data).toMatchObject({
      centre_id: fx.centreId,
      technology: 'T03',
      district_id: fx.districtId,
      taluka_id: fx.talukaId,
      pin_code: '411038',
      gender: 'Female',
      score: '72.5',
      grading_type: 'PERCENTAGE',
      disability_status: 'No',
    });
    expect(await AppDataSource.getRepository(Student).count()).toBe(0);
    const view = await request(app).get(`${EDP}/application`).set(bearer(token));
    expect(view.body.data.registration.display).toMatchObject({
      centre: 'Pune EDP Centre',
      district: 'Pune',
      taluka: 'Haveli',
    });
    expect(view.body.data.form).toMatchObject({ centre_id: fx.centreId, technology: 'T03', score: '72.5' });
  });
});

describe('Center Master in the EDP tracking panel', () => {
  async function adminToken() {
    await AppDataSource.query(
      `INSERT INTO "edp_admins" ("name", "email", "passwordHash") VALUES ('EDP Admin', 'centre.admin@example.invalid', $1)`,
      [await bcrypt.hash('Admin-pass-1', 4)],
    );
    const res = await request(app)
      .post(`${EDP}/manage/auth/login`)
      .send({ email: 'centre.admin@example.invalid', password: 'Admin-pass-1' });
    return res.body.data.token as string;
  }
  const post = (t: string, b: Record<string, unknown>) => request(app).post(`${EDP}/manage/centres`).set(bearer(t)).send(b);

  it('creates, allocates technologies, edits and deactivates centres; a portal token is refused', async () => {
    const t = await adminToken();
    const created = await post(t, {
      name: 'Nashik Centre',
      code: 'nsk-01',
      districtId: fx.districtId,
      talukaId: fx.talukaId,
      technologyCodes: ['t03', 'T05'],
    });
    expect(created.status).toBe(HTTP_STATUS.CREATED);
    expect(created.body.data).toMatchObject({ code: 'NSK-01', districtName: 'Pune', talukaName: 'Haveli', isActive: true });
    expect(created.body.data.technologies.map((t: { code: string }) => t.code)).toEqual(['T03', 'T05']);
    const id = created.body.data.id as string;

    /* Name unique within the district (case-insensitive); a taluka of another district is refused. */
    expect((await post(t, { name: 'nashik centre', code: 'NSK-02', districtId: fx.districtId })).status).toBe(HTTP_STATUS.CONFLICT);
    expect((await post(t, { name: 'X Centre', code: 'X-1', districtId: fx.districtId, talukaId: fx.otherTalukaId })).status).toBe(
      HTTP_STATUS.BAD_REQUEST,
    );

    const edited = await request(app)
      .patch(`${EDP}/manage/centres/${id}`)
      .set(bearer(t))
      .send({ technologyCodes: ['T05'] });
    expect(edited.body.data.technologies).toEqual([{ code: 'T05', name: 'IT Infrastructure & Smart Technologies', usable: true }]);
    /* Only codes of the technology list can be allocated. */
    expect(
      (
        await request(app)
          .patch(`${EDP}/manage/centres/${id}`)
          .set(bearer(t))
          .send({ technologyCodes: ['T99'] })
      ).status,
    ).toBe(HTTP_STATUS.BAD_REQUEST);

    const off = await request(app).patch(`${EDP}/manage/centres/${id}/status`).set(bearer(t)).send({ isActive: false });
    expect(off.body.data.isActive).toBe(false);
    expect((await request(app).get(`${EDP}/options`)).body.data.centres.map((c: { id: string }) => c.id)).not.toContain(id);
    expect((await request(app).get(`${EDP}/manage/centres?search=nashik`).set(bearer(t))).body.meta.total).toBe(1);

    const student = await verifiedToken();
    expect((await request(app).get(`${EDP}/manage/centres`).set(bearer(student))).status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect((await request(app).get(`${EDP}/manage/centres`)).status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });
});

describe('Center Master in the Amrut admin panel', () => {
  it('is the same data, needs the cms-centres permissions, and keeps a referenced centre from deletion', async () => {
    const admin = bearer(await amrutAdminToken());
    const list = await request(app).get(`${API}/cms/centres`).set(admin);
    expect(list.status).toBe(HTTP_STATUS.OK);
    expect(list.body.data.map((c: { id: string }) => c.id).sort()).toEqual([fx.centreId, fx.emptyCentreId].sort());
    const detail = await request(app).get(`${API}/cms/centres/${fx.centreId}`).set(admin);
    expect(detail.body.data.technologies).toEqual([{ code: 'T03', name: 'Web Design & Development', usable: true }]);
    expect((await request(app).get(`${API}/cms/centres/technology-options`).set(admin)).body.data).toHaveLength(12);

    const viewer = await actorWith(['cms-centres.view']);
    expect((await request(app).get(`${API}/cms/centres`).set(bearer(viewer.token))).status).toBe(HTTP_STATUS.OK);
    const create = { name: 'Viewer Centre', code: 'VIEW-1', districtId: fx.districtId };
    expect((await request(app).post(`${API}/cms/centres`).set(bearer(viewer.token)).send(create)).status).toBe(HTTP_STATUS.FORBIDDEN);
    const nobody = await actorWith(['cms-colleges.view']);
    expect((await request(app).get(`${API}/cms/centres`).set(bearer(nobody.token))).status).toBe(HTTP_STATUS.FORBIDDEN);

    /* Referenced by a submitted registration: 409, deactivate instead. An unused centre can be deleted. */
    await submitted();
    expect((await request(app).delete(`${API}/cms/centres/${fx.centreId}`).set(admin)).status).toBe(HTTP_STATUS.CONFLICT);
    expect((await request(app).delete(`${API}/cms/centres/${fx.emptyCentreId}`).set(admin)).status).toBe(HTTP_STATUS.OK);
  });
});

describe('Other masters respect the Center Master and EDP registrations', () => {
  it('refuses to delete a district or taluka a centre uses, or to move that taluka', async () => {
    const admin = bearer(await amrutAdminToken());
    await AppDataSource.query(`UPDATE "edp_centres" SET "talukaId" = $1 WHERE "id" = $2`, [fx.talukaId, fx.centreId]);
    const district = await request(app).delete(`${API}/cms/districts/${fx.districtId}`).set(admin);
    expect(district.status).toBe(HTTP_STATUS.CONFLICT);
    const taluka = await request(app).delete(`${API}/cms/talukas/${fx.talukaId}`).set(admin);
    expect(taluka.status).toBe(HTTP_STATUS.CONFLICT);
    expect(taluka.body.message).toMatch(/center/);
    const [nashik] = await AppDataSource.query(`SELECT "id" FROM "districts" WHERE "code" = 'NASHIK'`);
    const move = await request(app).patch(`${API}/cms/talukas/${fx.talukaId}`).set(admin).send({ districtId: nashik.id });
    expect(move.status).toBe(HTTP_STATUS.CONFLICT);
    expect(move.body.message).toMatch(/center/);
  });

  it('the EDP tracking panel shows a candidate in full (View), with every document, which it can open', async () => {
    await AppDataSource.query(
      `INSERT INTO "edp_admins" ("name", "email", "passwordHash") VALUES ('EDP Admin', 'view.admin@example.invalid', $1)`,
      [await bcrypt.hash('Admin-pass-1', 4)],
    );
    const admin = (
      await request(app).post(`${EDP}/manage/auth/login`).send({ email: 'view.admin@example.invalid', password: 'Admin-pass-1' })
    ).body.data.token as string;
    const token = await verifiedToken();
    const b = await basic({ disability_status: 'Yes', disability_type: 'Locomotor', disability_certificate_number: 'UDID1234' });
    expect((await step(token, 1, b)).status).toBe(HTTP_STATUS.OK);
    expect((await step(token, 2, await main())).status).toBe(HTTP_STATUS.OK);
    expect((await uploadAll(token, [...(await mandatoryCodes()), 'APPLICANT_VIDEO'])).status).toBe(HTTP_STATUS.OK);
    const result = await submit(token);
    expect(result.status).toBe(HTTP_STATUS.CREATED);
    const [acc] = await AppDataSource.query(`SELECT "accountId" FROM "edp_applications" WHERE "registrationCode" = $1`, [
      result.body.data.registration_id,
    ]);

    const view = await request(app).get(`${EDP}/manage/applicants/${acc.accountId}`).set(bearer(admin));
    expect(view.status).toBe(HTTP_STATUS.OK);
    expect(view.body.data).toMatchObject({
      account: { name: 'Kavya Jadhav', mobile_number: '9765412345' },
      status: 'SUBMITTED',
      registration: { registration_id: result.body.data.registration_id, registration_number: result.body.data.registration_number },
      aadhaar_masked: `XXXX-XXXX-${b.aadhaar_number.slice(-4)}`,
      form: expect.objectContaining({
        father_name: 'Suresh Jadhav',
        disability_type: 'Locomotor',
        qualification_name: 'Bachelor of Commerce',
        aadhaar_number: '',
      }),
      display: expect.objectContaining({
        centre: 'Pune EDP Centre',
        district: 'Pune',
        taluka: 'Haveli',
        caste: 'मराठी',
        technology: 'Web Design & Development',
      }),
    });
    const docs = view.body.data.documents as { code: string; required: boolean; file: { original_name: string } | null }[];
    expect(docs.map((d) => d.code)).toEqual([
      'PHOTO',
      'SIGNATURE',
      'AADHAAR_CARD',
      'AADHAAR_PHOTO',
      'APPLICANT_VIDEO',
      'PAN_CARD',
      'HSC_DIPLOMA',
      'EDU_CERT',
      'INCOME_EWS',
      'SCHOOL_LEAVING',
      'DOMICILE',
    ]);
    expect(docs.every((d) => d.file)).toBe(true);
    const video = await request(app).get(`${EDP}/manage/applicants/${acc.accountId}/documents/APPLICANT_VIDEO/file`).set(bearer(admin));
    expect(video.status).toBe(HTTP_STATUS.OK);
    expect(video.headers['content-type']).toMatch(/video\/mp4/);

    /* A candidate still filling in the form can be viewed too; a portal token or no token cannot. */
    const drafting = await verifiedToken();
    await step(drafting, 1, { father_name: 'Ramesh Patil' }, false);
    const [d] = await AppDataSource.query(`SELECT "accountId" FROM "edp_applications" WHERE "status" = 'DRAFT'`);
    const dv = await request(app).get(`${EDP}/manage/applicants/${d.accountId}`).set(bearer(admin));
    expect(dv.body.data).toMatchObject({
      status: 'DRAFT',
      registration: null,
      form: expect.objectContaining({ father_name: 'Ramesh Patil' }),
    });
    expect((await request(app).get(`${EDP}/manage/applicants/${d.accountId}`).set(bearer(drafting))).status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect((await request(app).get(`${EDP}/manage/applicants/${d.accountId}`)).status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect((await request(app).get(`${EDP}/manage/applicants/7b1f2c3e-1111-4222-8333-444455556666`).set(bearer(admin))).status).toBe(
      HTTP_STATUS.NOT_FOUND,
    );
  });
});

describe('EDP tracking panel: downloading a candidate’s documents', () => {
  /* GET with the tracking panel token, the body read as a Buffer (a ZIP). */
  const getBinary = (url: string, token: string) =>
    request(app)
      .get(url)
      .set(bearer(token))
      .buffer(true)
      .parse((res, cb) => {
        const c: Buffer[] = [];
        res.on('data', (x: Buffer) => c.push(x));
        res.on('end', () => cb(null, Buffer.concat(c)));
      });
  /* The entry names of a ZIP. */
  const zipNames = (buf: Buffer) =>
    new Promise<string[]>((resolve, reject) =>
      yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
        if (err || !zip) return reject(err);
        const names: string[] = [];
        zip.on('entry', (e: { fileName: string }) => {
          names.push(e.fileName);
          zip.readEntry();
        });
        zip.on('end', () => resolve(names));
        zip.on('error', reject);
        zip.readEntry();
      }),
    );

  it('downloads one document under the candidate’s name, and all of them as one folder in a ZIP', async () => {
    await AppDataSource.query(
      `INSERT INTO "edp_admins" ("name", "email", "passwordHash") VALUES ('EDP Admin', 'zip.admin@example.invalid', $1)`,
      [await bcrypt.hash('Admin-pass-1', 4)],
    );
    const admin = (
      await request(app).post(`${EDP}/manage/auth/login`).send({ email: 'zip.admin@example.invalid', password: 'Admin-pass-1' })
    ).body.data.token as string;
    const token = await verifiedToken();
    expect((await step(token, 1, await basic())).status).toBe(HTTP_STATUS.OK);
    expect((await step(token, 2, await main())).status).toBe(HTTP_STATUS.OK);
    expect((await uploadAll(token, [...(await mandatoryCodes()), 'APPLICANT_VIDEO'])).status).toBe(HTTP_STATUS.OK);
    const [{ accountId }] = await AppDataSource.query(`SELECT "accountId" FROM "edp_applications"`);

    /* Before submission: the folder is named DRAFT_<name>. */
    const draftZip = await getBinary(`${EDP}/manage/applicants/${accountId}/documents.zip`, admin);
    expect(draftZip.status).toBe(HTTP_STATUS.OK);
    expect(draftZip.headers['content-disposition']).toContain('filename="DRAFT_Kavya_Jadhav.zip"');

    const result = (await submit(token)).body.data as { registration_id: string };
    const folder = `${result.registration_id}_Kavya_Jadhav`;

    const one = await request(app)
      .get(`${EDP}/manage/applicants/${accountId}/documents/PAN_CARD/file`)
      .query({ download: '1' })
      .set(bearer(admin));
    expect(one.status).toBe(HTTP_STATUS.OK);
    expect(one.headers['content-disposition']).toMatch(new RegExp(`^attachment; filename="${folder}_PAN_Card[.]pdf"`));
    const inline = await request(app).get(`${EDP}/manage/applicants/${accountId}/documents/PAN_CARD/file`).set(bearer(admin));
    expect(inline.headers['content-disposition']).toMatch(/^inline;/);

    const zip = await getBinary(`${EDP}/manage/applicants/${accountId}/documents.zip`, admin);
    expect(zip.status).toBe(HTTP_STATUS.OK);
    expect(zip.headers['content-type']).toBe('application/zip');
    expect(zip.headers['content-disposition']).toContain(`filename="${folder}.zip"`);
    expect(await zipNames(zip.body as Buffer)).toEqual([
      `${folder}/01_Photo.pdf`,
      `${folder}/02_Signature.pdf`,
      `${folder}/03_Aadhar_Card.pdf`,
      `${folder}/04_Applicant_Photograph_with_Aadhaar.pdf`,
      `${folder}/05_Applicant_Video_with_Aadhaar.mp4`,
      `${folder}/06_PAN_Card.pdf`,
      `${folder}/07_12th_Pass_Or_3_Years_Diploma_Pass_Marksheet_Certificate.pdf`,
      `${folder}/08_Highest_Qualification_Certificate_Marksheet.pdf`,
      `${folder}/09_EWS_Certificate.pdf`,
      `${folder}/10_School_Leaving_Certificate_Transfer_Certificate.pdf`,
      `${folder}/11_Domicile_of_Certificate_Maharashtra.pdf`,
    ]);

    /* Nothing uploaded: 404; a portal token or no token: 401. */
    const empty = await verifiedToken();
    await step(empty, 1, { father_name: 'Ramesh Patil' }, false);
    const [e] = await AppDataSource.query(`SELECT "accountId" FROM "edp_applications" WHERE "status" = 'DRAFT'`);
    expect((await request(app).get(`${EDP}/manage/applicants/${e.accountId}/documents.zip`).set(bearer(admin))).status).toBe(
      HTTP_STATUS.NOT_FOUND,
    );
    expect((await request(app).get(`${EDP}/manage/applicants/${accountId}/documents.zip`).set(bearer(token))).status).toBe(
      HTTP_STATUS.UNAUTHORIZED,
    );
    expect((await request(app).get(`${EDP}/manage/applicants/${accountId}/documents.zip`)).status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });
});

describe('EDP tracking panel users: ADMIN and view-only VIEWER', () => {
  async function signIn(email: string, password: string) {
    const res = await request(app).post(`${EDP}/manage/auth/login`).send({ email, password });
    expect(res.status).toBe(HTTP_STATUS.OK);
    return res.body.data as { token: string; admin: { role: string } };
  }

  it('lets an ADMIN add a VIEWER, who can only view and download', async () => {
    await AppDataSource.query(
      `INSERT INTO "edp_admins" ("name", "email", "passwordHash") VALUES ('Lead Admin', 'lead.admin@example.invalid', $1)`,
      [await bcrypt.hash('Admin-pass-1', 4)],
    );
    const admin = await signIn('lead.admin@example.invalid', 'Admin-pass-1');
    expect(admin.admin.role).toBe('ADMIN');
    const A = bearer(admin.token);
    expect((await request(app).get(`${EDP}/manage/me`).set(A)).body.data.role).toBe('ADMIN');

    /* Validation, then the user is added; the same email again is refused. */
    const bad = await request(app).post(`${EDP}/manage/users`).set(A).send({ name: 'V', email: 'nope', password: 'short', role: 'BOSS' });
    expect(bad.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    /* One entry per failing field (the password breaks two rules, so it is reported twice). */
    expect([...new Set(bad.body.error.details.map((d: { field: string }) => d.field))].sort()).toEqual([
      'body.email',
      'body.name',
      'body.password',
      'body.role',
    ]);
    const added = await request(app)
      .post(`${EDP}/manage/users`)
      .set(A)
      .send({ name: 'Priya Viewer', email: 'Priya.Viewer@example.invalid', password: 'Viewer-pass-1', role: 'VIEWER' });
    expect(added.status).toBe(HTTP_STATUS.CREATED);
    expect(added.body.data).toMatchObject({ name: 'Priya Viewer', email: 'priya.viewer@example.invalid', role: 'VIEWER', is_active: true });
    expect(
      (
        await request(app)
          .post(`${EDP}/manage/users`)
          .set(A)
          .send({ name: 'Dup', email: 'priya.viewer@example.invalid', password: 'Viewer-pass-1', role: 'VIEWER' })
      ).status,
    ).toBe(HTTP_STATUS.CONFLICT);
    expect((await request(app).get(`${EDP}/manage/users`).set(A)).body.data.map((u: { email: string }) => u.email)).toEqual([
      'priya.viewer@example.invalid',
      'lead.admin@example.invalid',
    ]);

    /* The viewer: views and downloads… */
    const viewer = await signIn('priya.viewer@example.invalid', 'Viewer-pass-1');
    expect(viewer.admin.role).toBe('VIEWER');
    const V = bearer(viewer.token);
    const { token } = await submitted();
    void token;
    const [{ accountId }] = await AppDataSource.query(`SELECT "accountId" FROM "edp_applications"`);
    for (const path of [
      '/manage/summary',
      '/manage/applicants',
      `/manage/applicants/${accountId}`,
      `/manage/applicants/${accountId}/follow-ups`,
      `/manage/applicants/${accountId}/documents/PHOTO/file?download=1`,
      `/manage/applicants/${accountId}/documents.zip`,
      '/manage/centres',
      `/manage/centres/${fx.centreId}`,
    ])
      expect([path, (await request(app).get(`${EDP}${path}`).set(V)).status]).toEqual([path, HTTP_STATUS.OK]);

    /* …and changes nothing. */
    const forbidden = async (res: { status: number; body: { message: string } }) => {
      expect(res.status).toBe(HTTP_STATUS.FORBIDDEN);
      expect(res.body.message).toBe('Your account can only view. Ask an administrator to make this change.');
    };
    await forbidden(
      await request(app).post(`${EDP}/manage/centres`).set(V).send({ name: 'Viewer Centre', code: 'VW-1', districtId: fx.districtId }),
    );
    await forbidden(await request(app).patch(`${EDP}/manage/centres/${fx.centreId}`).set(V).send({ name: 'Renamed' }));
    await forbidden(await request(app).patch(`${EDP}/manage/centres/${fx.centreId}/status`).set(V).send({ isActive: false }));
    await forbidden(await request(app).post(`${EDP}/manage/applicants/${accountId}/follow-ups`).set(V).send({ status: 'CALLED' }));
    await forbidden(await request(app).get(`${EDP}/manage/users`).set(V));
    await forbidden(
      await request(app)
        .post(`${EDP}/manage/users`)
        .set(V)
        .send({ name: 'X Y', email: 'x@example.invalid', password: 'Viewer-pass-1', role: 'ADMIN' }),
    );
    const [centre] = await AppDataSource.query(`SELECT "name", "isActive" FROM "edp_centres" WHERE "id" = $1`, [fx.centreId]);
    expect(centre).toEqual({ name: 'Pune EDP Centre', isActive: true });

    /* An ADMIN deactivates the viewer (not themself); a deactivated viewer cannot sign in. */
    const viewerId = added.body.data.id as string;
    expect((await request(app).patch(`${EDP}/manage/users/${viewerId}/status`).set(A).send({ is_active: false })).body.data.is_active).toBe(
      false,
    );
    expect(
      (await request(app).post(`${EDP}/manage/auth/login`).send({ email: 'priya.viewer@example.invalid', password: 'Viewer-pass-1' }))
        .status,
    ).toBe(HTTP_STATUS.UNAUTHORIZED);
    const [{ id: adminId }] = await AppDataSource.query(`SELECT "id" FROM "edp_admins" WHERE "email" = 'lead.admin@example.invalid'`);
    expect((await request(app).patch(`${EDP}/manage/users/${adminId}/status`).set(A).send({ is_active: false })).status).toBe(
      HTTP_STATUS.CONFLICT,
    );
  });
});

describe('EDP support contact line, edited in the tracking panel', () => {
  async function tokenFor(email: string, role: 'ADMIN' | 'VIEWER') {
    await AppDataSource.query(`INSERT INTO "edp_admins" ("name", "email", "passwordHash", "role") VALUES ($1, $2, $3, $4)`, [
      role === 'ADMIN' ? 'Support Admin' : 'Support Viewer',
      email,
      await bcrypt.hash('Admin-pass-1', 4),
      role,
    ]);
    return (await request(app).post(`${EDP}/manage/auth/login`).send({ email, password: 'Admin-pass-1' })).body.data.token as string;
  }

  it('lets an ADMIN save the message, email and mobile; students then see them; a VIEWER cannot change them', async () => {
    const A = bearer(await tokenFor('support.admin@example.invalid', 'ADMIN'));
    const V = bearer(await tokenFor('support.viewer@example.invalid', 'VIEWER'));

    /* The defaults until something is saved. */
    const first = await request(app).get(`${EDP}/manage/settings/support`).set(V);
    expect(first.status).toBe(HTTP_STATUS.OK);
    expect(first.body.data).toMatchObject({ email: 'edp.help@example.invalid', updated_at: null, updated_by: null });

    /* Validation: a placeholder needs its value; the mobile must be a phone number. */
    const bad = await request(app)
      .put(`${EDP}/manage/settings/support`)
      .set(A)
      .send({ message: 'Write to {email} or call {mobile}.', email: '', mobile: 'call us' });
    expect(bad.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(bad.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual(['body.email', 'body.mobile']);

    const body = {
      message: 'If you have any query related to your registration, you can contact us on email ID {email} or mobile number {mobile}.',
      email: 'PrasadP@sumagoinfotech.com',
      mobile: '8530092236',
    };
    const saved = await request(app).put(`${EDP}/manage/settings/support`).set(A).send(body);
    expect(saved.status).toBe(HTTP_STATUS.OK);
    expect(saved.body.data).toMatchObject({ ...body, email: 'prasadp@sumagoinfotech.com', updated_by: 'Support Admin' });
    expect(saved.body.data.updated_at).toEqual(expect.any(String));

    /* Students see the saved line. */
    expect((await request(app).get(`${EDP}/options`)).body.data.support).toEqual({ ...body, email: 'prasadp@sumagoinfotech.com' });

    /* A viewer reads it but cannot save. */
    expect((await request(app).get(`${EDP}/manage/settings/support`).set(V)).body.data.mobile).toBe('8530092236');
    const refused = await request(app).put(`${EDP}/manage/settings/support`).set(V).send(body);
    expect(refused.status).toBe(HTTP_STATUS.FORBIDDEN);

    /* A message without placeholders may leave the contacts empty. */
    const plain = await request(app)
      .put(`${EDP}/manage/settings/support`)
      .set(A)
      .send({ message: 'Please visit your nearest EDP centre for help.', email: '', mobile: '' });
    expect(plain.body.data).toMatchObject({ message: 'Please visit your nearest EDP centre for help.', email: null, mobile: null });
  });
});
