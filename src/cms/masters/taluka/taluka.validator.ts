import { z } from 'zod';
import { idParams, masterCode, masterName, statusBody, uuid } from '../../../shared/validation/common.validation';
import { listQueryAscSchema } from '../../../shared/utils/pagination';

/*
 * A taluka code is optional: published taluka code lists are often unavailable, and forcing one would
 * only invite invented values. An empty string from a form field is normalised to null.
 */
const talukaCode = z.union([masterCode(20, { hyphen: true }), z.literal('').transform(() => null), z.null()]);

export const listTalukasSchema = {
  query: listQueryAscSchema(['name', 'code', 'districtName', 'stateName', 'createdAt', 'updatedAt'] as const).extend({
    stateId: uuid.optional(),
    districtId: uuid.optional(),
  }),
};

export const talukaIdSchema = { params: idParams };

/*
 * stateId is accepted but optional. It is the first dropdown of the cascading form, and the service
 * uses it only to reject a districtId that does not belong to it — the district is what is stored.
 */
export const createTalukaSchema = {
  body: z
    .object({
      stateId: uuid.optional(),
      districtId: uuid,
      name: masterName,
      code: talukaCode.optional(),
      isActive: z.boolean().optional(),
    })
    .strict(),
};

export const updateTalukaSchema = {
  params: idParams,
  body: z
    .object({
      stateId: uuid.optional(),
      districtId: uuid.optional(),
      name: masterName.optional(),
      code: talukaCode.optional(),
    })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
};

export const talukaStatusSchema = { params: idParams, body: statusBody };

export type ListTalukasQuery = z.infer<typeof listTalukasSchema.query>;
export type CreateTalukaBody = z.infer<typeof createTalukaSchema.body>;
export type UpdateTalukaBody = z.infer<typeof updateTalukaSchema.body>;
