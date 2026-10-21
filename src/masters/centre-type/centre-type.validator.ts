import { z } from 'zod';
import { entityName, idParams, masterCode, optionalText, statusBody } from '../../shared/validation/common.validation';
import { listQueryAscSchema } from '../../shared/utils/pagination';

/* A centre type code is short, e.g. OWNED or PARTNER. The same shape is a CHECK constraint on the table. */
const centreTypeCode = masterCode(20, { hyphen: true });
const centreTypeName = entityName({ max: 100 });

export const listCentreTypesSchema = { query: listQueryAscSchema(['name', 'code', 'createdAt', 'updatedAt'] as const) };
export const centreTypeIdSchema = { params: idParams };

export const createCentreTypeSchema = {
  body: z
    .object({
      name: centreTypeName,
      code: centreTypeCode,
      description: optionalText(500),
      isActive: z.boolean().optional(),
    })
    .strict(),
};

export const updateCentreTypeSchema = {
  params: idParams,
  body: z
    .object({ name: centreTypeName.optional(), code: centreTypeCode.optional(), description: optionalText(500) })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
};

export const centreTypeStatusSchema = { params: idParams, body: statusBody };

export type ListCentreTypesQuery = z.infer<typeof listCentreTypesSchema.query>;
export type CreateCentreTypeBody = z.infer<typeof createCentreTypeSchema.body>;
export type UpdateCentreTypeBody = z.infer<typeof updateCentreTypeSchema.body>;
