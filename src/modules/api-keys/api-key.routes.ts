import { Router } from 'express';
import { MESSAGES } from '../../constants/api-response.constants';
import { authenticate } from '../../middleware/authenticate.middleware';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { body, query, validateRequest } from '../../middleware/validate-request.middleware';
import { asyncHandler } from '../../shared/http/async-handler';
import { ApiResponse } from '../../utils/api-response';
import { apiKeyService } from './api-key.service';
import {
  apiKeyIdSchema,
  createApiKeySchema,
  listApiKeysSchema,
  revokeApiKeySchema,
  rotateApiKeySchema,
  type CreateApiKeyBody,
  type ListApiKeysQuery,
  type RevokeApiKeyBody,
  type RotateApiKeyBody,
} from './api-key.validation';

/*
 * /api/v1/api-keys — Amrut-issued API keys (M1: the key the LMS Super Admin enters in the LMS's AMRUT provider).
 * Permissions follow the "LMS Integration" menu: lms.view (list) · lms.create (generate) · lms.update (rotate) ·
 * lms.delete (revoke). Generate and rotate return the secret once; it is never shown again. Every change is audited.
 */
export const apiKeyRouter = Router();
apiKeyRouter.use(authenticate);

apiKeyRouter.get(
  '/',
  authorizePermission('lms.view'),
  validateRequest(listApiKeysSchema),
  asyncHandler(async (req, res) => {
    ApiResponse.ok(res, await apiKeyService.list(query<ListApiKeysQuery>(req)), MESSAGES.retrieved('API keys'));
  }),
);
apiKeyRouter.get(
  '/:id',
  authorizePermission('lms.view'),
  validateRequest(apiKeyIdSchema),
  asyncHandler(async (req, res) => {
    ApiResponse.ok(res, await apiKeyService.get(String(req.params.id)), MESSAGES.retrieved('API key'));
  }),
);
apiKeyRouter.post(
  '/',
  authorizePermission('lms.create'),
  validateRequest(createApiKeySchema),
  asyncHandler(async (req, res) => {
    const b = body<CreateApiKeyBody>(req);
    res.setHeader('Cache-Control', 'no-store');
    ApiResponse.created(
      res,
      await apiKeyService.create(
        { label: b.label, scopes: b.scopes, expiresAt: b.expiresAt ? new Date(b.expiresAt) : null },
        req.auth!,
        req,
      ),
      'API key generated. Copy the key now: it is shown only once.',
    );
  }),
);
apiKeyRouter.post(
  '/:id/rotate',
  authorizePermission('lms.update'),
  validateRequest(rotateApiKeySchema),
  asyncHandler(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    ApiResponse.created(
      res,
      await apiKeyService.rotate(String(req.params.id), body<RotateApiKeyBody>(req), req.auth!, req),
      'API key rotated. Copy the new key now: it is shown only once.',
    );
  }),
);
apiKeyRouter.post(
  '/:id/revoke',
  authorizePermission('lms.delete'),
  validateRequest(revokeApiKeySchema),
  asyncHandler(async (req, res) => {
    ApiResponse.ok(
      res,
      await apiKeyService.revoke(String(req.params.id), body<RevokeApiKeyBody>(req).reason, req.auth!, req),
      'API key revoked',
    );
  }),
);
