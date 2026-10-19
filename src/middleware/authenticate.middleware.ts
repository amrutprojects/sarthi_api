import type { RequestHandler } from 'express';
import { authService } from '../modules/auth';
import { AppError } from '../shared/errors/app-error';

/*
 * Requires `Authorization: Bearer <token>`. Verifies the token, checks revocation, re-checks that the
 * user is still active and not deleted, and attaches req.auth with effective permissions.
 * Any failure is 401.
 */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.header('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    next(AppError.unauthorized('Authentication required'));
    return;
  }
  Promise.resolve()
    .then(() => authService.verifyAccessToken(token))
    .then((payload) => authService.resolvePrincipal(payload))
    .then((auth) => {
      req.auth = auth;
      next();
    })
    .catch(next);
};
