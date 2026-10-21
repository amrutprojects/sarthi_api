import { z } from 'zod';
import { entityName, idParams, masterCode, optionalText, statusBody } from '../../shared/validation/common.validation';
import { listQueryAscSchema } from '../../shared/utils/pagination';

/* A department code is short, e.g. CSE or MECH-01. The same shape is a CHECK constraint on the table. */
const departmentCode = masterCode(20, { hyphen: true });
const departmentName = entityName({ max: 100 });

export const listDepartmentsSchema = { query: listQueryAscSchema(['name', 'code', 'createdAt', 'updatedAt'] as const) };
export const departmentIdSchema = { params: idParams };

export const createDepartmentSchema = {
  body: z
    .object({
      name: departmentName,
      code: departmentCode,
      description: optionalText(500),
      isActive: z.boolean().optional(),
    })
    .strict(),
};

export const updateDepartmentSchema = {
  params: idParams,
  body: z
    .object({ name: departmentName.optional(), code: departmentCode.optional(), description: optionalText(500) })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
};

export const departmentStatusSchema = { params: idParams, body: statusBody };

export type ListDepartmentsQuery = z.infer<typeof listDepartmentsSchema.query>;
export type CreateDepartmentBody = z.infer<typeof createDepartmentSchema.body>;
export type UpdateDepartmentBody = z.infer<typeof updateDepartmentSchema.body>;
