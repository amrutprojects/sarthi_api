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
