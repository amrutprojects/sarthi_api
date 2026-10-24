import { z } from 'zod';
import { idParams } from '../../shared/validation/common.validation';

export const roleLmsAccessSchema = { params: idParams };
export const replaceRoleLmsPermissionsSchema = {
  params: idParams,
  body: z.object({ codes: z.array(z.string().trim().min(1).max(100)).max(500) }).strict(),
};
export const lmsSignInSchema = {
  body: z.object({ identifier: z.string().trim().toLowerCase().email().max(255), password: z.string().min(1).max(200) }).strict(),
};
export const lmsUserAccessSchema = { params: idParams };
/* API-122 GET /integration/v1/reference: page ≥ 1, page_size ≤ 500, updated_since optional (full list when absent). */
export const lmsReferencePullSchema = {
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(500).default(500),
    updated_since: z
      .string()
      .datetime({ offset: true, message: 'Must be an ISO 8601 date-time' })
      .transform((v) => new Date(v))
      .optional(),
  }),
};
export type LmsReferencePullQuery = z.infer<typeof lmsReferencePullSchema.query>;
