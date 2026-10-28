import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { RequestHandler, Response } from 'express';
import { appConfig } from '../../../config/app.config';
import { env } from '../../../config/env.config';
import { AppDataSource } from '../../../config/database.config';
import { AppError } from '../../../shared/errors/app-error';
import { EDP_MESSAGES, EDP_VIEW_ONLY_MESSAGE } from './edp.constants';
import { EdpAccount, EdpAdmin } from './edp.entities';

/*
 * Tokens of the EDP portal (students) and its tracking panel (EDP admins). Signed with keys of their own (EDP_JWT_SECRET,
 * or one derived from JWT_SECRET), one per audience: a portal token is never accepted by the Amrut admin API, by the
 * tracking panel, or the other way round. Bearer only; the portal keeps the token in the browser's session.
 */
export type EdpAudience = 'edp-student' | 'edp-admin';
const ISSUER = 'amrut-edp';
const base = env.EDP_JWT_SECRET ?? crypto.createHmac('sha256', env.JWT_SECRET).update('edp-portal').digest('hex');
const keyFor = (purpose: string) => crypto.createHmac('sha256', base).update(purpose).digest('hex');
const KEYS: Record<EdpAudience, string> = { 'edp-student': keyFor('edp-student'), 'edp-admin': keyFor('edp-admin') };
/* Keys the one-time code hashes (so a database copy alone cannot check guesses offline). */
const OTP_KEY = keyFor('edp-otp');
/* Keys the password reset link hashes: the database holds only an HMAC of each link's token. */
const RESET_KEY = keyFor('edp-password-reset');

/* Which password a student session was signed in with: when it was last changed (ms), 0 = never changed. */
export const passwordVersion = (account: { passwordChangedAt: Date | null }) => account.passwordChangedAt?.getTime() ?? 0;

/* `pv`: the account's passwordVersion at sign-in (student sessions); a later password change makes the session invalid. */
export function signEdpToken(audience: EdpAudience, subject: string, pv = 0): { token: string; expiresAt: string } {
  const expiresInSeconds = Math.round(appConfig.edp.sessionHours * 3600);
  const token = jwt.sign({ pv }, KEYS[audience], {
    algorithm: 'HS256',
    subject,
    audience,
    issuer: ISSUER,
    expiresIn: expiresInSeconds,
    jwtid: crypto.randomUUID(),
  });
  return { token, expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString() };
}

/* The token's subject and password version (a token from before the version was added counts as 0). */
function verify(audience: EdpAudience, token: string): { id: string; pv: number } {
  try {
    const p = jwt.verify(token, KEYS[audience], { algorithms: ['HS256'], audience, issuer: ISSUER }) as jwt.JwtPayload;
    if (!p.sub) throw new Error('no subject');
    return { id: p.sub, pv: typeof p.pv === 'number' ? p.pv : 0 };
  } catch {
    throw AppError.unauthorized('Your session has expired. Please log in again.');
  }
}

/* A new random token for a password reset link (256 bits, URL-safe), and the HMAC the database keeps of it. */
export const newResetToken = () => crypto.randomBytes(32).toString('base64url');
export const hashResetToken = (token: string) => crypto.createHmac('sha256', RESET_KEY).update(token).digest('hex');

export const hashOtp = (accountId: string, otp: string) => crypto.createHmac('sha256', OTP_KEY).update(`${accountId}:${otp}`).digest('hex');

export function otpMatches(accountId: string, otp: string, stored: string | null): boolean {
  if (!stored) return false;
  const a = Buffer.from(hashOtp(accountId, otp), 'hex');
  const b = Buffer.from(stored.trim(), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const bearer = (header: string | undefined) => {
  const [scheme, value] = (header ?? '').split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : null;
};

/*
 * Signed-in portal student: res.locals.edpAccount (active, not deleted, email verified). A session signed in before the
 * password was last changed (Forgot password) is refused, so a reset also signs out every other device.
 */
export const requireEdpStudent: RequestHandler = (req, res, next) => {
  const token = bearer(req.header('authorization'));
  if (!token) return next(AppError.unauthorized('Please log in to continue.'));
  Promise.resolve()
    .then(async () => {
      const { id, pv } = verify('edp-student', token);
      const account = await AppDataSource.getRepository(EdpAccount).findOne({ where: { id, isDelete: false } });
      if (!account || !account.isActive || !account.emailVerifiedAt) throw AppError.unauthorized('Please log in to continue.');
      if (pv !== passwordVersion(account)) throw AppError.unauthorized(EDP_MESSAGES.PASSWORD_CHANGED_SIGN_IN);
      res.locals.edpAccount = account;
      next();
    })
    .catch(next);
};

/* Signed-in tracking-panel admin: res.locals.edpAdmin. */
export const requireEdpAdmin: RequestHandler = (req, res, next) => {
  const token = bearer(req.header('authorization'));
  if (!token) return next(AppError.unauthorized('Please log in to continue.'));
  Promise.resolve()
    .then(async () => {
      const { id } = verify('edp-admin', token);
      const admin = await AppDataSource.getRepository(EdpAdmin).findOne({ where: { id, isDelete: false } });
      if (!admin || !admin.isActive) throw AppError.unauthorized('Please log in to continue.');
      res.locals.edpAdmin = admin;
      next();
    })
    .catch(next);
};

/* A signed-in tracking-panel ADMIN: a VIEWER (view and download only) gets 403. Use after requireEdpAdmin. */
export const requireEdpEditor: RequestHandler = (_req, res, next) => {
  const admin = res.locals.edpAdmin as EdpAdmin | undefined;
  if (!admin) return next(AppError.unauthorized('Please log in to continue.'));
  if (admin.role !== 'ADMIN') return next(AppError.forbidden(EDP_VIEW_ONLY_MESSAGE));
  next();
};

export const edpAccountOf = (res: Response) => res.locals.edpAccount as EdpAccount;
export const edpAdminOf = (res: Response) => res.locals.edpAdmin as EdpAdmin;
