import type { RequestHandler } from 'express';
import { AUDIT_ACTIONS } from '../shared/constants/app.constants';
import type { PermissionCode } from '../modules/roles-permissions';
import { auditService } from '../modules/audit';
import { AppError } from '../shared/errors/app-error';

/*
 * Deny-by-default permission guard. Must run after authenticate().
 * - authorizePermission('users.view')                      → requires that permission
 * - authorizePermission(['a.b', 'c.d'])                    → requires ALL listed
 * - authorizePermission(['a.b', 'c.d'], { any: true })     → requires ANY listed
 * Denials return 403 and are written to the audit log.
 */
export function authorizePermission(required: PermissionCode | PermissionCode[], opts: { any?: boolean } = {}): RequestHandler {
  const codes = Array.isArray(required) ? required : [required];
  if (!codes.length) throw new Error('authorizePermission() needs at least one permission code');

  return (req, _res, next) => {
    const auth = req.auth;
    if (!auth) {
      next(AppError.unauthorized());
      return;
    }
    const allowed = opts.any ? codes.some((c) => auth.permissions.has(c)) : codes.every((c) => auth.permissions.has(c));
    if (allowed) {
      next();
      return;
    }
    /* Written before responding so the denial is never lost; record() never throws. */
    auditService
      .record(req, {
        action: AUDIT_ACTIONS.AUTHZ_DENIED,
        resource: 'route',
        resourceId: `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`.slice(0, 100),
        outcome: 'DENIED',
        details: { required: codes, mode: opts.any ? 'any' : 'all' },
      })
      .finally(() => next(AppError.forbidden()));
  };
}
