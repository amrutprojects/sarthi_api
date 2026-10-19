import { z } from 'zod';
import { idParams, masterCode, masterName, statusBody } from '../../../shared/validation/common.validation';
import { listQueryAscSchema } from '../../../shared/utils/pagination';

/* A state code is short and alphanumeric, e.g. MH. The same shape is a CHECK constraint on the table. */
const stateCode = masterCode(10);

export const listStatesSchema = { query: listQueryAscSchema(['name', 'code', 'createdAt', 'updatedAt'] as const) };
export const stateIdSchema = { params: idParams };

export const createStateSchema = {
  body: z
    .object({
      name: masterName,
      code: stateCode,
      isActive: z.boolean().optional(),
    })
    .strict(),
};

/*
 * Name and code are both editable: a master record created with a typo has to be fixable, and the
 * service re-checks uniqueness against the other states before writing.
 */
export const updateStateSchema = {
  params: idParams,
  body: z
    .object({ name: masterName.optional(), code: stateCode.optional() })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
};

export const stateStatusSchema = { params: idParams, body: statusBody };

export type ListStatesQuery = z.infer<typeof listStatesSchema.query>;
export type CreateStateBody = z.infer<typeof createStateSchema.body>;
export type UpdateStateBody = z.infer<typeof updateStateSchema.body>;
