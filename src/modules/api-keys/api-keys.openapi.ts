import { z } from 'zod';
import { documentEndpoint, envelope, registry } from '../../shared/openapi/registry';
import { apiKeyIdSchema, createApiKeySchema, listApiKeysSchema, revokeApiKeySchema, rotateApiKeySchema } from './api-key.validation';

/* M1: Amrut-issued API key management. Shapes for the Panel screens: docs/lms-integration-api-keys.md. */

const ApiKeyDto = registry.register(
  'ApiKey',
  z.object({
    id: z.string().uuid(),
    label: z.string(),
    prefix: z.string().describe('Public part of the key, 12 hex characters'),
    displayPrefix: z.string().describe('amk_<prefix>_…'),
    scopes: z.array(z.string()),
    status: z.enum(['ACTIVE', 'REVOKED']),
    state: z.enum(['ACTIVE', 'EXPIRING', 'EXPIRED', 'REVOKED']).describe('EXPIRING: rotated, still valid until expiresAt'),
    expiresAt: z.string().nullable(),
    createdAt: z.string(),
    createdById: z.string().uuid().nullable(),
    rotatedAt: z.string().nullable(),
    rotatedById: z.string().uuid().nullable(),
    replacedById: z.string().uuid().nullable(),
    rotatedFromId: z.string().uuid().nullable(),
    revokedAt: z.string().nullable(),
    revokedById: z.string().uuid().nullable(),
    revokedReason: z.string().nullable(),
    lastUsedAt: z.string().nullable(),
  }),
);
const keyTag = 'API keys';
documentEndpoint({
  method: 'get',
  path: '/api-keys',
  tag: keyTag,
  summary: 'Amrut-issued API keys (never the secret)',
  permission: 'lms.view',
  request: { query: listApiKeysSchema.query },
  response: envelope(z.array(ApiKeyDto)),
});
documentEndpoint({
  method: 'get',
  path: '/api-keys/:id',
  tag: keyTag,
  summary: 'One API key',
  permission: 'lms.view',
  request: { params: apiKeyIdSchema.params },
  response: envelope(ApiKeyDto),
  errors: [404],
});
documentEndpoint({
  method: 'post',
  path: '/api-keys',
  tag: keyTag,
  summary: 'Generate a key (the secret is in this answer only)',
  permission: 'lms.create',
  request: { body: createApiKeySchema.body },
  response: envelope(z.object({ key: ApiKeyDto, secret: z.string().describe('amk_<prefix>_<secret>: shown once') })),
  errors: [400],
});
documentEndpoint({
  method: 'post',
  path: '/api-keys/:id/rotate',
  tag: keyTag,
  summary: 'Rotate a key: a new key replaces it; the old one keeps working for the overlap window',
  permission: 'lms.update',
  request: { params: rotateApiKeySchema.params, body: rotateApiKeySchema.body },
  response: envelope(z.object({ key: ApiKeyDto, secret: z.string(), previous: ApiKeyDto })),
  errors: [404, 409],
});
documentEndpoint({
  method: 'post',
  path: '/api-keys/:id/revoke',
  tag: keyTag,
  summary: 'Revoke a key (refused from the next request on)',
  permission: 'lms.delete',
  request: { params: revokeApiKeySchema.params, body: revokeApiKeySchema.body },
  response: envelope(ApiKeyDto),
  status: 200,
  errors: [404, 409],
});
