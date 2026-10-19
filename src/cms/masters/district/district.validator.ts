import { z } from 'zod';
import { idParams, masterCode, masterName, statusBody, uuid } from '../../../validators/common.validator';
import { listQueryAscSchema } from '../../../utils/pagination';

/* District codes allow a hyphen so a prefixed form such as MH-PUN is possible. */
const districtCode = masterCode(20, { hyphen: true });

export const listDistrictsSchema = {
  query: listQueryAscSchema(['name', 'code', 'stateName', 'createdAt', 'updatedAt'] as const).extend({
    stateId: uuid.optional(),
  }),
};

export const districtIdSchema = { params: idParams };

export const createDistrictSchema = {
  body: z
    .object({
      stateId: uuid,
      name: masterName,
      code: districtCode,
      isActive: z.boolean().optional(),
    })
    .strict(),
};

/*
 * stateId may be changed: a district entered under the wrong state has to be movable. The service then
 * re-validates the new state and re-checks the name and code against it.
 */
export const updateDistrictSchema = {
  params: idParams,
  body: z
    .object({ stateId: uuid.optional(), name: masterName.optional(), code: districtCode.optional() })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
};

export const districtStatusSchema = { params: idParams, body: statusBody };

export type ListDistrictsQuery = z.infer<typeof listDistrictsSchema.query>;
export type CreateDistrictBody = z.infer<typeof createDistrictSchema.body>;
export type UpdateDistrictBody = z.infer<typeof updateDistrictSchema.body>;
