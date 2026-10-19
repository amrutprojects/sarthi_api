import { createHmac, timingSafeEqual } from 'crypto';
import type { CookieOptions, Request, Response } from 'express';
import { appConfig } from '../../config/app.config';

/*
 * Browser session transport (ADR-0003). The access token travels in an HttpOnly cookie, so page
 * scripts can never read it. Requests authenticated by that cookie must also send X-CSRF-Token on
 * state-changing methods; the CSRF token is an HMAC of the session id, so it needs no storage and
 * stays the same when the access token is renewed.
 */
export const CSRF_HEADER = 'x-csrf-token';
export const AUTH_MODE_HEADER = 'x-auth-mode';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const cookieOptions = (maxAgeMs?: number): CookieOptions => ({
  httpOnly: true,
  secure: appConfig.session.secure,
  sameSite: appConfig.session.sameSite,
  domain: appConfig.session.domain,
  path: '/',
  ...(maxAgeMs !== undefined ? { maxAge: maxAgeMs } : {}),
});

export function setSessionCookie(res: Response, token: string, expiresAtSec: number): void {
  res.cookie(appConfig.session.cookieName, token, cookieOptions(Math.max(0, expiresAtSec * 1000 - Date.now())));
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(appConfig.session.cookieName, cookieOptions());
}

/* Minimal Cookie header parser (avoids a dependency for one cookie). */
export function readSessionCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === appConfig.session.cookieName) {
      try { return decodeURIComponent(part.slice(i + 1).trim()) || null; } catch { return null; }
    }
  }
  return null;
}

export const csrfTokenFor = (sessionId: string): string =>
  createHmac('sha256', appConfig.jwt.secret).update(`csrf:${sessionId}`).digest('base64url');

export const needsCsrf = (req: Request): boolean => !SAFE_METHODS.has(req.method.toUpperCase());

export function csrfValid(req: Request, sessionId: string): boolean {
  const sent = Buffer.from(req.header(CSRF_HEADER) ?? '');
  const expected = Buffer.from(csrfTokenFor(sessionId));
  return sent.length === expected.length && timingSafeEqual(sent, expected);
}

/* API clients (scripts, tests, integrations) opt in to receiving the bearer token in the login response. */
export const wantsBearerToken = (req: Request): boolean => (req.header(AUTH_MODE_HEADER) ?? '').toLowerCase() === 'bearer';
