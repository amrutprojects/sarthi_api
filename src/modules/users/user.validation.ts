import { z } from 'zod';
import { listQuerySchema } from '../../shared/utils/pagination';
import { email, idList, idParams, name, password, statusBody, uuid } from '../../shared/validation/common.validation';

export const listUsersSchema = {
  query: listQuerySchema(['createdAt', 'name', 'email', 'lastLoginAt'] as const).extend({ roleId: uuid.optional() }),
};

export const userIdSchema = { params: idParams };

export const createUserSchema = {
  body: z
    .object({
      name,
      email,
      password,
      isActive: z.boolean().optional(),
      roleIds: idList('roleIds').optional(),
    })
    .strict(),
};

export const updateUserSchema = {
  params: idParams,
  body: z
    .object({ name: name.optional(), email: email.optional(), password: password.optional() })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
};

export const userStatusSchema = { params: idParams, body: statusBody };

export const replaceUserRolesSchema = {
  params: idParams,
  body: z.object({ roleIds: idList('roleIds') }).strict(),
};

export type ListUsersQuery = z.infer<typeof listUsersSchema.query>;
export type CreateUserBody = z.infer<typeof createUserSchema.body>;
export type UpdateUserBody = z.infer<typeof updateUserSchema.body>;
