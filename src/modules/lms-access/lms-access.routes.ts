import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ERROR_CODES, HTTP_STATUS, MESSAGES, RESPONSE_MESSAGES } from '../../constants/api-response.constants';
import { appConfig } from '../../config/app.config';
import { authenticate } from '../../middleware/authenticate.middleware';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { body, validateRequest } from '../../middleware/validate-request.middleware';
import { asyncHandler } from '../../shared/http/async-handler';
import { ApiResponse } from '../../utils/api-response';
import { P } from '../roles-permissions';
import { verifyLmsSignature } from './integration-signature';
import { lmsAccessService } from './lms-access.service';
import { lmsSignInSchema, lmsUserAccessSchema, replaceRoleLmsPermissionsSchema, roleLmsAccessSchema } from './lms-access.validation';

/* /api/v1/lms-access — LMS menus on LMS roles (Admin Panel → Users & Roles). */
export const lmsAccessRouter = Router();
lmsAccessRouter.use(authenticate);

lmsAccessRouter.get(
  '/catalogue',
  authorizePermission(P.ROLES_VIEW),
  asyncHandler(async (_req, res) => {
    ApiResponse.ok(res, lmsAccessService.catalogue(), MESSAGES.retrieved('LMS menus'));
  }),
);
lmsAccessRouter.get(
  '/roles/:id',
  authorizePermission(P.ROLES_VIEW),
  validateRequest(roleLmsAccessSchema),
  asyncHandler(async (req, res) => {
    ApiResponse.ok(res, await lmsAccessService.forRole(String(req.params.id)), MESSAGES.retrieved('LMS menus'));
  }),
);
lmsAccessRouter.put(
  '/roles/:id',
  authorizePermission(P.PERMISSIONS_ASSIGN),
  validateRequest(replaceRoleLmsPermissionsSchema),
  asyncHandler(async (req, res) => {
    const { codes } = body<{ codes: string[] }>(req);
    ApiResponse.ok(res, await lmsAccessService.replaceForRole(String(req.params.id), codes, req.auth!, req), MESSAGES.updated('LMS menus'));
  }),
);

/* Brute-force limit per email on the LMS sign-in check (all calls come from the LMS server's single address). */
const signInLimiter = rateLimit({
  windowMs: appConfig.rateLimit.windowMs,
  limit: appConfig.rateLimit.loginMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `lms-sign-in:${String((req.body as { identifier?: unknown } | undefined)?.identifier ?? '').toLowerCase()}`,
  handler: (_req, res) => {
    ApiResponse.error(res, HTTP_STATUS.TOO_MANY_REQUESTS, RESPONSE_MESSAGES.TOO_MANY_REQUESTS, ERROR_CODES.RATE_LIMITED);
  },
});

/*
 * /integration/v1/lms — called by the LMS server only, signed with LMS_INTEGRATION_SECRET (integration-signature.ts).
 * Lets an Admin Panel user sign in to the LMS with the same email and password; the LMS shows the LMS menus ticked on
 * the user's LMS roles.
 */
export const lmsIntegrationRouter = Router();
lmsIntegrationRouter.use(verifyLmsSignature);

lmsIntegrationRouter.post(
  '/sign-in',
  validateRequest(lmsSignInSchema),
  signInLimiter,
  asyncHandler(async (req, res) => {
    const { identifier, password } = body<{ identifier: string; password: string }>(req);
    ApiResponse.ok(res, await lmsAccessService.verifySignIn(identifier, password, req), 'Sign-in verified');
  }),
);
/* Re-check on every LMS session refresh: suspension, role or LMS-menu changes reach the LMS without a new sign-in. */
lmsIntegrationRouter.get(
  '/users/:id/access',
  validateRequest(lmsUserAccessSchema),
  asyncHandler(async (req, res) => {
    const access = await lmsAccessService.accessFor(String(req.params.id));
    if (!access) {
      ApiResponse.error(res, HTTP_STATUS.NOT_FOUND, MESSAGES.notFound('User'), ERROR_CODES.NOT_FOUND);
      return;
    }
    ApiResponse.ok(res, access, MESSAGES.retrieved('LMS access'));
  }),
);
