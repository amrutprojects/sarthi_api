import { z } from 'zod';
import {
  entityName, idParams, masterCode, optionalEmail, optionalMobile, optionalPhone, optionalText, optionalUuid, statusBody, uuid,
} from '../../shared/validation/common.validation';
import { listQueryAscSchema } from '../../shared/utils/pagination';

/* A centre code is A–Z then A–Z / 0–9, 2–10 characters, no hyphen (e.g. TC0001). Same shape as the CHECK on the table. */
const centreCode = masterCode(10);
const centreName = entityName({ min: 3, max: 150 });

/*
 * On create the code is optional: blank or absent means "generate one" (TC0001…), so an empty string
 * becomes null rather than failing the length rule.
 */
const createCentreCode = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  centreCode.nullable().optional(),
);

/* Sections A–B optional columns (Table 32). Each: absent = leave alone, '' or null = clear. */
const optionalColumns = {
  centreTypeId: optionalUuid,
  talukaId: optionalUuid,
  contactNumber: optionalPhone,
  email: optionalEmail,
  pocName: optionalText(120),
  pocMobile: optionalMobile,
  centreHead: optionalText(120),
  alternativeContact: optionalText(160),
  coordinator1: optionalText(160),
  coordinator2: optionalText(160),
};

export const listTrainingCentresSchema = {
  query: listQueryAscSchema(['name', 'code', 'districtName', 'centreTypeName', 'createdAt', 'updatedAt'] as const).extend({
    centreTypeId: uuid.optional(),
    stateId: uuid.optional(),
    districtId: uuid.optional(),
  }),
};

export const trainingCentreIdSchema = { params: idParams };

/*
 * stateId is accepted but optional. It is the first dropdown of the State -> District -> Taluka cascade,
 * and the service uses it only to reject a districtId that does not belong to it: the district is what
 * is stored, and the state is derived from it.
 */
export const createTrainingCentreSchema = {
  body: z
    .object({
      stateId: uuid.optional(),
      districtId: uuid,
      name: centreName,
      code: createCentreCode,
      ...optionalColumns,
      isActive: z.boolean().optional(),
    })
    .strict(),
};

/*
 * Once assigned, the code cannot be blanked (the column is NOT NULL); it may be changed until a batch
 * uses the centre. When districtId changes, talukaId must be sent too (a taluka of the new district, or
 * null) — the service enforces that.
 */
export const updateTrainingCentreSchema = {
  params: idParams,
  body: z
    .object({
      stateId: uuid.optional(),
      districtId: uuid.optional(),
      name: centreName.optional(),
      code: centreCode.optional(),
      ...optionalColumns,
    })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
};

export const trainingCentreStatusSchema = { params: idParams, body: statusBody };

export type ListTrainingCentresQuery = z.infer<typeof listTrainingCentresSchema.query>;
export type CreateTrainingCentreBody = z.infer<typeof createTrainingCentreSchema.body>;
export type UpdateTrainingCentreBody = z.infer<typeof updateTrainingCentreSchema.body>;
