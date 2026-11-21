import { z } from 'zod';
import { idParams } from '../../shared/validation/common.validation';
import { API_KEY_SCOPES, ROTATION_OVERLAP } from './api-key.secret';

const scopes = z.array(z.enum(API_KEY_SCOPES)).min(1).max(API_KEY_SCOPES.length);

export const listApiKeysSchema = {
  query: z.object({ state: z.enum(['ACTIVE', 'EXPIRING', 'EXPIRED', 'REVOKED']).optional() }).strict(),
};
export const apiKeyIdSchema = { params: idParams };
export const createApiKeySchema = {
  body: z
    .object({
      label: z.string().trim().min(2).max(100),
      /* Default: every scope (the LMS key needs match, create and update). */
      scopes: scopes.optional(),
      /* Optional hard expiry (ISO 8601 date-time, in the future). */
      expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
    })
    .strict(),
};
export const rotateApiKeySchema = {
  params: idParams,
  body: z
    .object({
      /* How long the replaced key keeps working: 0 = stops now; default one day; at most seven days. */
      overlapMinutes: z.number().int().min(0).max(ROTATION_OVERLAP.MAX_MINUTES).optional(),
    })
    .strict(),
};
export const revokeApiKeySchema = {
  params: idParams,
  body: z.object({ reason: z.string().trim().min(3).max(300) }).strict(),
};

export type CreateApiKeyBody = z.infer<typeof createApiKeySchema.body>;
export type RotateApiKeyBody = z.infer<typeof rotateApiKeySchema.body>;
export type RevokeApiKeyBody = z.infer<typeof revokeApiKeySchema.body>;
export type ListApiKeysQuery = z.infer<typeof listApiKeysSchema.query>;
