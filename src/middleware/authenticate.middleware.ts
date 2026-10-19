import type { RequestHandler } from 'express';
import { ERROR_CODES, HTTP_STATUS, RESPONSE_MESSAGES } from '../constants/api-response.constants';
import { appConfig } from '../config/app.config';
import { authService, csrfValid, needsCsrf, readSessionCookie, setSessionCookie } from '../modules/auth';
import { AppError } from '../shared/errors/app-error';

/*
 * Authenticates the request (ADR-0003), from either
 * - `Authorization: Bearer <token>` (API clients; no CSRF check needed), or
 * - the HttpOnly session cookie (browsers; state-changing methods must send a valid X-CSRF-Token).
 * Verifies the token, checks revocation, re-checks that the user is still active and not deleted, and
 * attaches req.auth with effective permissions. Cookie sessions past half their token lifetime get a
 * fresh token, until the absolute session limit. Any failure is 401 (403 for a CSRF failure).
 */
export const authenticate: RequestHandler = (req, res, next) => {
  const [scheme, bearer] = (req.header('authorization') ?? '').split(' ');
  const viaBearer = scheme?.toLowerCase() === 'bearer' && !!bearer;
  const token = viaBearer ? bearer : readSessionCookie(req);
  if (!token) {
    next(AppError.unauthorized(RESPONSE_MESSAGES.UNAUTHORIZED));
    return;
  }
  Promise.resolve()
    .then(() => authService.verifyAccessToken(token))
    .then(async (payload) => {
      const auth = await authService.resolvePrincipal(payload, viaBearer ? 'bearer' : 'cookie');
      if (auth.via === 'cookie') {
        if (needsCsrf(req) && !csrfValid(req, auth.sessionId)) {
          throw new AppError(HTTP_STATUS.FORBIDDEN, RESPONSE_MESSAGES.CSRF_INVALID, ERROR_CODES.CSRF_INVALID);
        }
        const now = Math.floor(Date.now() / 1000);
        const halfLife = (payload.exp - payload.iat) / 2;
        const withinSession = now - payload.sst < appConfig.session.maxAgeSeconds;
        if (payload.exp - now < halfLife && withinSession) {
          const renewed = authService.signAccessToken(auth.id, { sid: payload.sid, sst: payload.sst });
          setSessionCookie(res, renewed.token, renewed.payload.exp);
        }
      }
      req.auth = auth;
      next();
    })
    .catch(next);
};
