import { Router, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { ERROR_CODES, HTTP_STATUS, MESSAGES, RESPONSE_MESSAGES } from '../../constants/api-response.constants';
import { referenceService } from '../../lms/reference/reference.service';
import { query, validateRequest } from '../../middleware/validate-request.middleware';
import { logger } from '../../observability/logger';
import { AppError } from '../../shared/errors/app-error';
import { asyncHandler } from '../../shared/http/async-handler';
import { ApiResponse } from '../../utils/api-response';
import { LMS_CLIENT_ID, verifyLmsSignature } from './integration-signature';
import { lmsReferencePullSchema, type LmsReferencePullQuery } from './lms-access.validation';

/* Scopes held by the LMS service client (API-122 needs reference.read). verifyLmsSignature admits client `lms` only. */
export const LMS_CLIENT_SCOPES: readonly string[] = ['reference.read'];
const CLIENT_SCOPES: Readonly<Record<string, readonly string[]>> = { [LMS_CLIENT_ID]: LMS_CLIENT_SCOPES };
const CLIENT_RE = /^AMK-HMAC ([a-z0-9-]+):/;

/* Runs after verifyLmsSignature: the client id in the (verified) Authorization header must hold `scope`, else 403. */
export function requireClientScope(scope: string): RequestHandler {
  return (req, _res, next) => {
    const client = CLIENT_RE.exec(req.header('authorization') ?? '')?.[1] ?? '';
    if (!(CLIENT_SCOPES[client] ?? []).includes(scope)) {
      next(AppError.forbidden(`The calling service client does not hold the ${scope} scope`));
      return;
    }
    next();
  };
}

/* API-122 rate limit: 30 calls a minute for the LMS client, on top of the global API limit. */
const referencePullLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: () => `lms-reference:${LMS_CLIENT_ID}`,
  handler: (_req, res) => {
    ApiResponse.error(res, HTTP_STATUS.TOO_MANY_REQUESTS, RESPONSE_MESSAGES.TOO_MANY_REQUESTS, ERROR_CODES.RATE_LIMITED);
  },
});

/*
 * /integration/v1/reference — API-122 (AMRUT_KALASH_03 §16.3.10), called by the LMS server only, signed with
 * LMS_INTEGRATION_SECRET (integration-signature.ts). Districts, training centres and technology tracks for the LMS's
 * read-only reference copy, paged by ?page / ?page_size (≤ 500), optionally only rows changed since ?updated_since.
 *
 * Read-only: only GET is registered, so any other method answers 404 once the signature is verified. Deleted and
 * inactive rows are sent as INACTIVE. Each pull is written to the integration access log with the request id.
 */
export const lmsReferenceRouter = Router();
lmsReferenceRouter.use(verifyLmsSignature);

lmsReferenceRouter.get(
  '/',
  requireClientScope('reference.read'),
  validateRequest(lmsReferencePullSchema),
  referencePullLimiter,
  asyncHandler(async (req, res) => {
    const q = query<LmsReferencePullQuery>(req);
    const data = await referenceService.pullSnapshot({ updatedSince: q.updated_since, page: q.page, pageSize: q.page_size });
    logger.info(
      {
        requestId: req.id,
        correlationId: req.header('x-correlation-id')?.slice(0, 100),
        client: LMS_CLIENT_ID,
        page: data.page,
        pageSize: data.page_size,
        updatedSince: q.updated_since?.toISOString() ?? null,
        sent: { districts: data.districts.length, centres: data.centres.length, tracks: data.tracks.length },
        hasMore: data.has_more,
      },
      'integration access: reference pulled',
    );
    ApiResponse.ok(res, data, MESSAGES.retrieved('Reference data'));
  }),
);
