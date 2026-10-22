import { z } from 'zod';
import { listQuerySchema } from '../../../shared/utils/pagination';
import { description, idList, idParams, statusBody } from '../../../shared/validation/common.validation';
import { ROLE_PLATFORMS } from '../role.constants';

const roleCode = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]{1,63}$/, 'Code must be UPPER_SNAKE_CASE (2–64 chars)');
const roleName = z.string().trim().min(1, 'Required').max(100);
/* ADMIN = Admin Panel role (default); LMS = LMS role, which carries LMS menus only. */
const rolePlatform = z.enum(ROLE_PLATFORMS);

export const listRolesSchema = { query: listQuerySchema(['createdAt', 'name', 'code'] as const) };
export const roleIdSchema = { params: idParams };

export const createRoleSchema = {
  body: z
    .object({
      name: roleName,
      code: roleCode,
      description,
      platform: rolePlatform.optional(),
      isActive: z.boolean().optional(),
      permissionIds: idList('permissionIds').optional(),
    })
    .strict(),
};

/* The code is immutable once created (it is referenced by clients and seeds). */
export const updateRoleSchema = {
  params: idParams,
  body: z
    .object({ name: roleName.optional(), description, platform: rolePlatform.optional() })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
};

export const roleStatusSchema = { params: idParams, body: statusBody };

export const replaceRolePermissionsSchema = {
  params: idParams,
  body: z.object({ permissionIds: idList('permissionIds') }).strict(),
};

export type ListRolesQuery = z.infer<typeof listRolesSchema.query>;
export type CreateRoleBody = z.infer<typeof createRoleSchema.body>;
export type UpdateRoleBody = z.infer<typeof updateRoleSchema.body>;
