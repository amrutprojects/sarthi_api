import { z } from 'zod';
import {
  entityName, idParams, masterCode, optionalEmail, optionalPhone, optionalPinCode, optionalText, optionalUuid, statusBody, uuid,
} from '../../shared/validation/common.validation';
import { listQueryAscSchema } from '../../shared/utils/pagination';

/* A college code is short, e.g. COEP or MIT-WPU. The same shape is a CHECK constraint on the table. */
const collegeCode = masterCode(20, { hyphen: true });
const collegeName = entityName({ max: 150 });

export const listCollegesSchema = {
  query: listQueryAscSchema(['name', 'code', 'districtName', 'createdAt', 'updatedAt'] as const).extend({
    stateId: uuid.optional(),
    districtId: uuid.optional(),
  }),
};

export const collegeIdSchema = { params: idParams };

/*
 * stateId is accepted but optional. It is the first dropdown of the cascading form, and the service
 * uses it only to reject a districtId that does not belong to it — the district is what is stored.
 * talukaId is optional; when given, the service checks that it belongs to the district.
 */
export const createCollegeSchema = {
  body: z
    .object({
      stateId: uuid.optional(),
      districtId: uuid,
      talukaId: optionalUuid,
      name: collegeName,
      code: collegeCode,
      address: optionalText(300),
      pinCode: optionalPinCode,
      contactNumber: optionalPhone,
      email: optionalEmail,
      isActive: z.boolean().optional(),
    })
    .strict(),
};

/*
 * The district may be changed (a college entered under the wrong district has to be movable). The
 * service then re-checks the name against the new district, and requires talukaId to be sent as well
 * when the college had a taluka: the old one belongs to the old district.
 */
export const updateCollegeSchema = {
  params: idParams,
  body: z
    .object({
      stateId: uuid.optional(),
      districtId: uuid.optional(),
      talukaId: optionalUuid,
      name: collegeName.optional(),
      code: collegeCode.optional(),
      address: optionalText(300),
      pinCode: optionalPinCode,
      contactNumber: optionalPhone,
      email: optionalEmail,
    })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
};

export const collegeStatusSchema = { params: idParams, body: statusBody };

export type ListCollegesQuery = z.infer<typeof listCollegesSchema.query>;
export type CreateCollegeBody = z.infer<typeof createCollegeSchema.body>;
export type UpdateCollegeBody = z.infer<typeof updateCollegeSchema.body>;
