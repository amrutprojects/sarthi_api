import { z } from 'zod';
import { listQuerySchema } from '../../../shared/utils/pagination';
import { description, idParams, statusBody } from '../../../shared/validation/common.validation';

const permissionCode = z.string().trim().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/, 'Code must look like module.action (lowercase)');
const permissionModule = z.string().trim().regex(/^[a-z][a-z0-9-]{0,63}$/, 'Module must be lowercase');
const permissionName = z.string().trim().min(1, 'Required').max(150);

export const listPermissionsSchema = {
  query: listQuerySchema(['module', 'code', 'name', 'createdAt'] as const).extend({ module: permissionModule.optional() }),
};
export const permissionIdSchema = { params: idParams };

export const createPermissionSchema = {
  body: z.object({
    name: permissionName,
    code: permissionCode,
    module: permissionModule.optional(),
    description,
    isActive: z.boolean().optional(),
  })
    .strict()
    .refine((b) => !b.module || b.code.startsWith(b.module + '.'), { message: 'Code must start with its module', path: ['code'] }),
};

/* The code is immutable: route guards depend on it. */
export const updatePermissionSchema = {
  params: idParams,
  body: z.object({ name: permissionName.optional(), description })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
};

export const permissionStatusSchema = { params: idParams, body: statusBody };

export type ListPermissionsQuery = z.infer<typeof listPermissionsSchema.query>;
export type CreatePermissionBody = z.infer<typeof createPermissionSchema.body>;
export type UpdatePermissionBody = z.infer<typeof updatePermissionSchema.body>;
