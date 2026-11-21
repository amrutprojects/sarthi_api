import type { RequestHandler } from 'express';
import { HTTP_STATUS } from '../../constants/api-response.constants';
import { logger } from '../../observability/logger';
import { ApiResponse } from '../../utils/api-response';
import { auditService } from '../audit';
import { API_KEY_AUDIT, apiKeyService } from './api-key.service';
import type { ApiKeyScope } from './api-key.secret';

export const API_KEY_HEADER = 'x-api-key';
export const API_KEY_INVALID = 'API_KEY_INVALID';

/*
 * Guards a route called by another system with an Amrut-issued key (header X-Api-Key, contract
 * amrut-student-api.md §1). Any failure — no key, a malformed, unknown, revoked or expired key, or a key without
 * `scope` — is the same 401 API_KEY_INVALID, so a caller learns nothing about which keys exist.
 *
 * The key never reaches a log line or an audit row: the logger keeps only the reason class and the request id
 * (the header is also on the logger's redaction list), and the audit row of a refused known key names its id.
 */
export function requireApiKey(scope: ApiKeyScope): RequestHandler {
  return (req, res, next) => {
    const presented = req.header(API_KEY_HEADER);
    apiKeyService
      .verify(presented, scope)
      .then(async (result) => {
        if (result.ok) {
          req.apiKey = result.key;
          apiKeyService
            .touch(result.key.id)
            .catch((err: unknown) => logger.error({ err, requestId: req.id }, 'api key last-use update failed'));
          next();
          return;
        }
        logger.warn({ requestId: req.id, reason: result.reason, keyId: result.keyId ?? null }, 'api key refused');
        if (result.keyId) {
          await auditService.record(req, {
            action: API_KEY_AUDIT.DENIED,
            resource: 'api_key',
            resourceId: result.keyId,
            outcome: 'DENIED',
            details: { reason: result.reason, scope },
          });
        }
        ApiResponse.error(res, HTTP_STATUS.UNAUTHORIZED, 'The API key is missing, invalid, revoked or expired', API_KEY_INVALID);
      })
      .catch(next);
  };
}
