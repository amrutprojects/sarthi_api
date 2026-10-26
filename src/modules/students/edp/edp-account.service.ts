import crypto from 'crypto';
import bcrypt from 'bcrypt';
import type { Request } from 'express';
import { QueryFailedError } from 'typeorm';
import { HTTP_STATUS, type HttpStatus } from '../../../constants/api-response.constants';
import { appConfig } from '../../../config/app.config';
import { AppDataSource } from '../../../config/database.config';
import { PG_ERROR } from '../../../shared/constants/app.constants';
import { AppError } from '../../../shared/errors/app-error';
import { auditService } from '../../audit';
import {
  EDP_ERROR_CODES,
  EDP_MESSAGES,
  EDP_OTP_LENGTH,
  EDP_OTP_MAX_ATTEMPTS,
  EDP_OTP_MAX_SENDS_PER_HOUR,
  EDP_RESET_LINK_MINUTES,
  EDP_RESET_MAX_PER_HOUR,
  EDP_RESET_RESEND_SECONDS,
} from './edp.constants';
import { EdpAccount, EdpApplication } from './edp.entities';
import { edpMailer } from './edp.mailer';
import { hashOtp, hashResetToken, newResetToken, otpMatches, passwordVersion, signEdpToken } from './edp.security';
import type { SignupBody } from './edp.validation';

const accounts = () => AppDataSource.getRepository(EdpAccount);
const HOUR_MS = 3600_000;
/* Compared against when the email is unknown, so a failed login takes as long either way. */
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 4);

const normaliseMobile = (v: string) =>
  v
    .replace(/[\s()-]/g, '')
    .replace(/^\+?91(?=\d{10}$)/, '')
    .replace(/^0(?=\d{10}$)/, '');

/* 45 → "45 seconds", 287 → "4 min 47 s", 300 → "5 min". */
const duration = (s: number) =>
  s < 60 ? `${s} second${s === 1 ? '' : 's'}` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;

const otpError = (status: HttpStatus, code: keyof typeof EDP_ERROR_CODES, message: string) =>
  new AppError(status, message, EDP_ERROR_CODES[code]);

export function accountDto(a: EdpAccount) {
  return {
    id: a.id,
    first_name: a.firstName,
    middle_name: a.middleName,
    last_name: a.lastName,
    email: a.email,
    mobile_number: a.mobile,
    email_verified: !!a.emailVerifiedAt,
  };
}

/* Every verified account has exactly one application, created on first use. */
export async function ensureApplication(accountId: string): Promise<void> {
  await AppDataSource.createQueryBuilder().insert().into(EdpApplication).values({ accountId }).orIgnore().execute();
}

/*
 * Emails a new one-time code, valid EDP_OTP_TTL_SECONDS (default 5 minutes). A new code can be requested
 * EDP_OTP_RESEND_SECONDS after the previous one (default: its lifetime, i.e. once it has expired); it replaces it (only
 * the newest code works), at most EDP_OTP_MAX_SENDS_PER_HOUR an hour per account. Only an HMAC of the code is stored.
 * The send slot is taken with a conditional update, so two simultaneous requests cannot both send.
 */
async function issueOtp(account: EdpAccount): Promise<{ otp_expires_in: number; resend_after: number }> {
  const ttl = appConfig.edp.otpTtlSeconds;
  const resend = appConfig.edp.otpResendSeconds;
  const now = new Date();
  const waitMs = account.otpSentAt ? account.otpSentAt.getTime() + resend * 1000 - now.getTime() : 0;
  if (waitMs > 0) {
    throw otpError(
      HTTP_STATUS.TOO_MANY_REQUESTS,
      'OTP_RESEND_TOO_SOON',
      `Please wait ${duration(Math.ceil(waitMs / 1000))} before requesting a new OTP.`,
    );
  }
  const windowOpen = account.otpWindowStart && now.getTime() - account.otpWindowStart.getTime() < HOUR_MS;
  const sends = windowOpen ? account.otpSendCount : 0;
  if (sends >= EDP_OTP_MAX_SENDS_PER_HOUR)
    throw otpError(HTTP_STATUS.TOO_MANY_REQUESTS, 'OTP_RESEND_TOO_SOON', 'Too many OTP requests. Please try again after an hour.');

  const otp = String(crypto.randomInt(0, 10 ** EDP_OTP_LENGTH)).padStart(EDP_OTP_LENGTH, '0');
  const taken = await accounts()
    .createQueryBuilder()
    .update()
    .set({
      otpHash: hashOtp(account.id, otp),
      otpExpiresAt: new Date(now.getTime() + ttl * 1000),
      otpSentAt: now,
      otpAttempts: 0,
      otpSendCount: sends + 1,
      otpWindowStart: windowOpen ? account.otpWindowStart : now,
    })
    .where('id = :id AND ("otpSentAt" IS NULL OR "otpSentAt" <= :cutoff)', {
      id: account.id,
      cutoff: new Date(now.getTime() - resend * 1000),
    })
    .execute();
  if (!taken.affected)
    throw otpError(HTTP_STATUS.TOO_MANY_REQUESTS, 'OTP_RESEND_TOO_SOON', 'An OTP was just sent. Please check your email.');
  try {
    await edpMailer.sendOtp(account.email, account.firstName, otp, ttl);
  } catch (err) {
    /* Not sent: free the slot so the student can try again straight away, and do not count it toward the hourly limit. */
    await accounts().update(account.id, {
      otpHash: null,
      otpExpiresAt: null,
      otpSentAt: null,
      otpSendCount: sends,
      otpWindowStart: windowOpen ? account.otpWindowStart : null,
    });
    throw err;
  }
  return { otp_expires_in: ttl, resend_after: resend };
}

/* The pending code's remaining lifetime and the wait before a new one, in seconds from now (0 = expired / now). */
function otpTiming(account: EdpAccount): { otp_expires_in: number; resend_after: number } {
  const now = Date.now();
  const left = (at: number) => Math.max(0, Math.ceil((at - now) / 1000));
  return {
    otp_expires_in: account.otpExpiresAt ? left(account.otpExpiresAt.getTime()) : 0,
    resend_after: account.otpSentAt ? left(account.otpSentAt.getTime() + appConfig.edp.otpResendSeconds * 1000) : 0,
  };
}

function session(account: EdpAccount) {
  const { token, expiresAt } = signEdpToken('edp-student', account.id, passwordVersion(account));
  return { token, expires_at: expiresAt, account: accountDto(account) };
}

const resetError = (code: 'RESET_LINK_INVALID' | 'RESET_LINK_EXPIRED') =>
  new AppError(HTTP_STATUS.BAD_REQUEST, EDP_MESSAGES[code], EDP_ERROR_CODES[code]);

/* The account a password reset link belongs to, while the link is usable. */
async function accountForResetToken(token: string): Promise<EdpAccount> {
  const account = await accounts()
    .createQueryBuilder('a')
    .where('a.resetTokenHash = :hash AND a.isDelete = false', { hash: hashResetToken(token) })
    .getOne();
  if (!account || !account.isActive || !account.resetExpiresAt) throw resetError('RESET_LINK_INVALID');
  if (account.resetExpiresAt.getTime() <= Date.now()) throw resetError('RESET_LINK_EXPIRED');
  return account;
}

export const edpAccountService = {
  /*
   * Create account: stores the account unverified and emails a one-time code; a verified email → 409. Signing up again
   * before verifying replaces the details and password (e.g. a corrected mobile number). While the code already sent still
   * works no new one is emailed (the page counts down that code); after it has expired a new one is. The code alone does
   * not finish the sign-up: verify-otp also needs the password chosen here, so someone who signs up with another
   * person's email cannot end up with a verified account carrying their own password.
   */
  async register(req: Request, body: SignupBody) {
    const existing = await accounts().findOne({ where: { email: body.email, isDelete: false } });
    if (existing?.emailVerifiedAt) throw AppError.conflict(EDP_MESSAGES.ACCOUNT_EXISTS);
    const values = {
      firstName: body.first_name,
      middleName: body.middle_name?.trim() || null,
      lastName: body.last_name,
      mobile: normaliseMobile(body.mobile_number),
      passwordHash: await bcrypt.hash(body.password, appConfig.bcryptRounds),
    };
    let account: EdpAccount;
    if (existing) {
      await accounts().update(existing.id, values);
      account = { ...existing, ...values };
    } else {
      try {
        account = await accounts().save(accounts().create({ ...values, email: body.email }));
      } catch (err) {
        if (err instanceof QueryFailedError && (err.driverError as { code?: string }).code === PG_ERROR.UNIQUE_VIOLATION)
          throw AppError.conflict('This email address was just registered. Please enter the OTP sent to it.');
        throw err;
      }
      await auditService.record(req, {
        action: 'edp.account.create',
        resource: 'edp_account',
        resourceId: account.id,
        actorUserId: null,
        details: {},
      });
    }
    if (otpTiming(account).otp_expires_in > 0) return { email: account.email, ...otpTiming(account) };
    return { email: account.email, ...(await issueOtp(account)) };
  },

  async resendOtp(email: string) {
    const account = await accounts().findOne({ where: { email, isDelete: false } });
    if (!account) throw AppError.notFound('No account was found for this email address. Please create an account.');
    if (account.emailVerifiedAt) throw AppError.conflict('This email address is already verified. Please log in.');
    return { email: account.email, ...(await issueOtp(account)) };
  },

  /*
   * When the pending code expires and when a new one can be asked for, as the server counts them: the OTP page asks on
   * opening, so its countdowns are right after a reload or a login too (it cannot know when the code was sent).
   */
  async otpStatus(email: string) {
    const account = await accounts().findOne({ where: { email, isDelete: false } });
    if (!account) throw AppError.notFound('No account was found for this email address. Please create an account.');
    if (account.emailVerifiedAt) throw AppError.conflict('This email address is already verified. Please log in.');
    return { email: account.email, ...otpTiming(account) };
  },

  /*
   * Checks the emailed code: past its expiry → 400 "OTP has expired" (checked first, so an expired code always says so),
   * wrong → 400 "Incorrect OTP" (EDP_OTP_MAX_ATTEMPTS per code). The code proves the inbox, not who chose the password,
   * so the password chosen at sign-up must come with it: another one → 400 SIGNUP_PASSWORD_MISMATCH (counted as a wrong
   * attempt). Correct → the account is verified, its application is created and the student is signed in.
   */
  async verifyOtp(req: Request, email: string, otp: string, password: string) {
    const account = await accounts()
      .createQueryBuilder('a')
      .addSelect('a.otpHash')
      .addSelect('a.passwordHash')
      .where('a.email = :email AND a.isDelete = false', { email })
      .getOne();
    if (!account) throw otpError(HTTP_STATUS.BAD_REQUEST, 'OTP_NOT_PENDING', EDP_MESSAGES.OTP_NOT_PENDING);
    if (account.emailVerifiedAt) throw AppError.conflict('This email address is already verified. Please log in.');
    if (!account.otpHash || !account.otpExpiresAt) throw otpError(HTTP_STATUS.BAD_REQUEST, 'OTP_NOT_PENDING', EDP_MESSAGES.OTP_NOT_PENDING);
    if (account.otpExpiresAt.getTime() < Date.now()) throw otpError(HTTP_STATUS.BAD_REQUEST, 'OTP_EXPIRED', EDP_MESSAGES.OTP_EXPIRED);
    if (account.otpAttempts >= EDP_OTP_MAX_ATTEMPTS)
      throw otpError(HTTP_STATUS.TOO_MANY_REQUESTS, 'OTP_TOO_MANY_ATTEMPTS', EDP_MESSAGES.OTP_TOO_MANY_ATTEMPTS);
    if (!otpMatches(account.id, otp, account.otpHash)) {
      await accounts().increment({ id: account.id }, 'otpAttempts', 1);
      throw otpError(HTTP_STATUS.BAD_REQUEST, 'OTP_INCORRECT', EDP_MESSAGES.OTP_INCORRECT);
    }
    if (!(await bcrypt.compare(password, account.passwordHash))) {
      await accounts().increment({ id: account.id }, 'otpAttempts', 1);
      throw otpError(HTTP_STATUS.BAD_REQUEST, 'SIGNUP_PASSWORD_MISMATCH', EDP_MESSAGES.SIGNUP_PASSWORD_MISMATCH);
    }
    /*
     * The code is used once: cleared in the same update that verifies the account (a replay finds it verified), and only
     * if the password is still the one just checked (not replaced by a sign-up in between).
     */
    const now = new Date();
    const done = await accounts()
      .createQueryBuilder()
      .update()
      .set({ emailVerifiedAt: now, otpHash: null, otpExpiresAt: null, otpAttempts: 0, lastLoginAt: now })
      .where('id = :id AND "emailVerifiedAt" IS NULL AND "passwordHash" = :ph', { id: account.id, ph: account.passwordHash })
      .execute();
    if (!done.affected) {
      const again = await accounts().findOne({ where: { id: account.id } });
      if (again?.emailVerifiedAt) throw AppError.conflict('This email address is already verified. Please log in.');
      throw otpError(HTTP_STATUS.BAD_REQUEST, 'SIGNUP_PASSWORD_MISMATCH', EDP_MESSAGES.SIGNUP_PASSWORD_MISMATCH);
    }
    await ensureApplication(account.id);
    await auditService.record(req, {
      action: 'edp.account.verified',
      resource: 'edp_account',
      resourceId: account.id,
      actorUserId: null,
      details: {},
    });
    return session({ ...account, emailVerifiedAt: now });
  },

  /* Email + password. An account whose email is not verified yet gets a fresh code and 403 EMAIL_NOT_VERIFIED. */
  async login(email: string, password: string) {
    const account = await accounts()
      .createQueryBuilder('a')
      .addSelect('a.passwordHash')
      .where('a.email = :email AND a.isDelete = false', { email })
      .getOne();
    const ok = await bcrypt.compare(password, account?.passwordHash ?? DUMMY_HASH);
    if (!account || !ok) throw AppError.unauthorized(EDP_MESSAGES.LOGIN_FAILED);
    if (!account.isActive) throw AppError.forbidden('This account has been disabled. Please contact the programme office.');
    if (!account.emailVerifiedAt) {
      await issueOtp(account).catch((err: unknown) => {
        if (!(err instanceof AppError && err.code === EDP_ERROR_CODES.OTP_RESEND_TOO_SOON)) throw err;
      });
      throw new AppError(HTTP_STATUS.FORBIDDEN, EDP_MESSAGES.NOT_VERIFIED, EDP_ERROR_CODES.EMAIL_NOT_VERIFIED);
    }
    await accounts().update(account.id, { lastLoginAt: new Date() });
    await ensureApplication(account.id);
    return session(account);
  },

  /*
   * Forgot password: emails a link to the portal's "new password" page, valid EDP_RESET_LINK_MINUTES and usable once, to
   * a registered email ID only. An email ID with no account → 404 EMAIL_NOT_REGISTERED (the programme office chose to tell
   * the student so); a disabled account → 403. A new link replaces the previous one; at most one per
   * EDP_RESET_RESEND_SECONDS and EDP_RESET_MAX_PER_HOUR an hour per account (past those → 429 RESET_TOO_SOON, no email).
   * The link's address is EDP_PORTAL_URL, never the request's.
   */
  async forgotPassword(req: Request, email: string): Promise<void> {
    const account = await accounts().findOne({ where: { email, isDelete: false } });
    if (!account) throw new AppError(HTTP_STATUS.NOT_FOUND, EDP_MESSAGES.EMAIL_NOT_REGISTERED, EDP_ERROR_CODES.EMAIL_NOT_REGISTERED);
    if (!account.isActive) throw AppError.forbidden('This account has been disabled. Please contact the programme office.');
    const now = new Date();
    const windowOpen = account.resetWindowStart && now.getTime() - account.resetWindowStart.getTime() < HOUR_MS;
    const sends = windowOpen ? account.resetSendCount : 0;
    const tooSoon = (message: string) => new AppError(HTTP_STATUS.TOO_MANY_REQUESTS, message, EDP_ERROR_CODES.RESET_TOO_SOON);
    if (sends >= EDP_RESET_MAX_PER_HOUR) throw tooSoon(EDP_MESSAGES.RESET_TOO_MANY);
    const waitMs = account.resetSentAt ? account.resetSentAt.getTime() + EDP_RESET_RESEND_SECONDS * 1000 - now.getTime() : 0;
    const justSent = () =>
      tooSoon(
        `A password reset link was just sent to this email ID. Please check your email, or try again in ${duration(Math.max(1, Math.ceil(waitMs / 1000)))}.`,
      );
    if (waitMs > 0) throw justSent();
    const token = newResetToken();
    const taken = await accounts()
      .createQueryBuilder()
      .update()
      .set({
        resetTokenHash: hashResetToken(token),
        resetExpiresAt: new Date(now.getTime() + EDP_RESET_LINK_MINUTES * 60_000),
        resetSentAt: now,
        resetSendCount: sends + 1,
        resetWindowStart: windowOpen ? account.resetWindowStart : now,
      })
      .where('id = :id AND ("resetSentAt" IS NULL OR "resetSentAt" <= :cutoff)', {
        id: account.id,
        cutoff: new Date(now.getTime() - EDP_RESET_RESEND_SECONDS * 1000),
      })
      .execute();
    /* Another request took the slot a moment ago. */
    if (!taken.affected) throw justSent();
    try {
      const link = `${appConfig.edp.portalUrl}/reset-password?token=${token}`;
      await edpMailer.sendPasswordReset(account.email, account.firstName, link, EDP_RESET_LINK_MINUTES);
    } catch (err) {
      /* Not sent: no link is pending, the student can ask again straight away, and it does not count toward the limit. */
      await accounts().update(account.id, {
        resetTokenHash: null,
        resetExpiresAt: null,
        resetSentAt: null,
        resetSendCount: sends,
        resetWindowStart: windowOpen ? account.resetWindowStart : null,
      });
      throw err;
    }
    await auditService.record(req, {
      action: 'edp.account.password_reset_requested',
      resource: 'edp_account',
      resourceId: account.id,
      actorUserId: null,
      details: {},
    });
  },

  /* Whether a reset link can still be used (the page asks before showing the form), and for which email. */
  async checkResetToken(token: string) {
    const account = await accountForResetToken(token);
    return { email: account.email };
  },

  /*
   * Sets the new password from a reset link, once: the link stops working, portal sessions signed in before now are
   * refused (every device is signed out), and a pending sign-up code is dropped. An account whose email was not verified
   * yet becomes verified: the link reached that email, as the code would have.
   */
  async resetPassword(req: Request, token: string, password: string) {
    const account = await accountForResetToken(token);
    const now = new Date();
    const done = await accounts()
      .createQueryBuilder()
      .update()
      .set({
        passwordHash: await bcrypt.hash(password, appConfig.bcryptRounds),
        passwordChangedAt: now,
        resetTokenHash: null,
        resetExpiresAt: null,
        emailVerifiedAt: account.emailVerifiedAt ?? now,
        otpHash: null,
        otpExpiresAt: null,
        otpAttempts: 0,
      })
      .where('id = :id AND "resetTokenHash" = :hash AND "resetExpiresAt" > :now', { id: account.id, hash: hashResetToken(token), now })
      .execute();
    if (!done.affected) throw resetError('RESET_LINK_INVALID');
    await ensureApplication(account.id);
    await auditService.record(req, {
      action: 'edp.account.password_reset',
      resource: 'edp_account',
      resourceId: account.id,
      actorUserId: null,
      details: { email_verified_by_link: !account.emailVerifiedAt },
    });
    return { email: account.email };
  },
};
