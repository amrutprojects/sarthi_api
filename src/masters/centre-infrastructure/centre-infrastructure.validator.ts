import { z } from 'zod';
import {
  idParams, optionalText, optionalWholeNumber, statusBody, uuid, wholeNumber,
} from '../../shared/validation/common.validation';
import { listQueryAscSchema } from '../../shared/utils/pagination';
import { FACILITY_AVAILABILITY, FACILITY_CODES, type FacilityCode, type FacilityMap } from '../shared/master.constants';

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

const maxSeatingCapacity = wholeNumber(1, 100000);

/* Yes / No, or null for "not recorded". Absent leaves the column alone on update. */
const amenity = z.boolean({ invalid_type_error: 'Choose Yes, No or Not recorded' }).nullable().optional();

/*
 * One facility row: Yes / No / To be confirmed, plus optional remarks. A row with no availability is
 * "not recorded" and is not stored; remarks on such a row are refused rather than silently dropped.
 */
const facilityEntry = z
  .object({
    availability: z.preprocess(
      blankToNull,
      z.enum(FACILITY_AVAILABILITY, { errorMap: () => ({ message: 'Choose Yes, No or To be confirmed' }) }).nullable().optional(),
    ),
    remarks: optionalText(200),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (!e.availability && e.remarks) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['availability'], message: 'Choose an availability before adding remarks' });
    }
  });

/* Keys are exactly the 20 facility codes (each optional); any other key is a 422. */
const facilityShape = Object.fromEntries(FACILITY_CODES.map((code) => [code, facilityEntry.optional()])) as Record<
  FacilityCode,
  z.ZodOptional<typeof facilityEntry>
>;

/* The map as stored: only the assessed facilities, in the canonical order, remarks null when empty. */
const facilities = z
  .object(facilityShape)
  .strict()
  .transform((input): FacilityMap => {
    const out: FacilityMap = {};
    for (const code of FACILITY_CODES) {
      const entry = input[code];
      if (entry?.availability) out[code] = { availability: entry.availability, remarks: entry.remarks ?? null };
    }
    return out;
  });

/* The fields shared by create and update. */
const fields = {
  numberOfFloors: optionalWholeNumber(0, 200),
  trainingRooms: optionalWholeNumber(0, 1000),
  computerSystems: optionalWholeNumber(0, 100000),
  internetType: optionalText(60),
  internetSpeed: optionalText(60),
  hasLift: amenity,
  hasAc: amenity,
  hasWashroom: amenity,
  hasDrinkingWater: amenity,
  powerBackup: optionalText(200),
  facilities: facilities.optional(),
};

export const listCentreInfrastructureSchema = {
  query: listQueryAscSchema(['centreName', 'centreCode', 'maxSeatingCapacity', 'createdAt', 'updatedAt'] as const).extend({
    centreId: uuid.optional(),
  }),
};

/* Same filter as the listing's centreId; unknown keys are stripped, as on the list query. */
export const centreInfrastructureSummarySchema = {
  query: z.object({ centreId: uuid.optional() }),
};

export const centreInfrastructureIdSchema = { params: idParams };

export const createCentreInfrastructureSchema = {
  body: z
    .object({ centreId: uuid, maxSeatingCapacity, ...fields, isActive: z.boolean().optional() })
    .strict(),
};

/*
 * centreId is deliberately absent: the record belongs to its centre for life. .strict() turns an
 * attempt to send it into a 422 instead of silently ignoring it.
 */
export const updateCentreInfrastructureSchema = {
  params: idParams,
  body: z
    .object({ maxSeatingCapacity: maxSeatingCapacity.optional(), ...fields })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
};

export const centreInfrastructureStatusSchema = { params: idParams, body: statusBody };

export type ListCentreInfrastructureQuery = z.infer<typeof listCentreInfrastructureSchema.query>;
export type CentreInfrastructureSummaryQuery = z.infer<typeof centreInfrastructureSummarySchema.query>;
export type CreateCentreInfrastructureBody = z.infer<typeof createCentreInfrastructureSchema.body>;
export type UpdateCentreInfrastructureBody = z.infer<typeof updateCentreInfrastructureSchema.body>;
