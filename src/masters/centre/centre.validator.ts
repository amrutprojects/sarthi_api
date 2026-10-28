import { z } from 'zod';
import {
  entityName,
  idParams,
  masterCode,
  optionalEmail,
  optionalPhone,
  optionalPinCode,
  optionalText,
  optionalUuid,
  statusBody,
  uuid,
} from '../../shared/validation/common.validation';
import { listQueryAscSchema } from '../../shared/utils/pagination';

/* Same code and name rules as the College Master; the same shape is a CHECK constraint on the table. */
const centreCode = masterCode(20, { hyphen: true });
const centreName = entityName({ max: 150 });

const PERSON_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u;
const contactPerson = optionalText(120).refine(
  (v) => v === undefined || v === null || PERSON_RE.test(v),
  "Contact person may contain only letters, spaces and . ' -",
);

/* The Technology / 3rd module selections (track codes T01–T12) offered at the centre; the service checks each one is active. */
const technologyCodes = z
  .array(
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^T\d{2}$/, 'Unknown technology'),
    { invalid_type_error: 'Technologies must be a list' },
  )
  .max(50, 'At most 50 technologies')
  .refine((a) => new Set(a).size === a.length, 'Each technology may be listed only once');

export const listCentresSchema = {
  query: listQueryAscSchema(['name', 'code', 'districtName', 'createdAt', 'updatedAt'] as const).extend({
    stateId: uuid.optional(),
    districtId: uuid.optional(),
    technologyCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^T\d{2}$/, 'Unknown technology')
      .optional(),
  }),
};

export const centreIdSchema = { params: idParams };

/* As the College Master: stateId only cross-checks the district; talukaId must belong to the district. */
const fields = {
  stateId: uuid.optional(),
  districtId: uuid,
  talukaId: optionalUuid,
  name: centreName,
  code: centreCode,
  address: optionalText(300),
  pinCode: optionalPinCode,
  contactPerson,
  contactNumber: optionalPhone,
  email: optionalEmail,
  technologyCodes: technologyCodes.optional(),
};

export const createCentreSchema = {
  body: z.object({ ...fields, isActive: z.boolean().optional() }).strict(),
};

/* technologyCodes, when sent, replaces the centre's allocation. */
export const updateCentreSchema = {
  params: idParams,
  body: z
    .object(fields)
    .partial()
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
};

export const centreStatusSchema = { params: idParams, body: statusBody };

export type ListCentresQuery = z.infer<typeof listCentresSchema.query>;
export type CreateCentreBody = z.infer<typeof createCentreSchema.body>;
export type UpdateCentreBody = z.infer<typeof updateCentreSchema.body>;
