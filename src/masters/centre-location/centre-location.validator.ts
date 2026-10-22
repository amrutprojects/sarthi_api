import { z } from 'zod';
import {
  idParams, optionalHttpsUrl, optionalPinCode, optionalText, statusBody, uuid,
} from '../../shared/validation/common.validation';
import { listQueryAscSchema } from '../../shared/utils/pagination';
import { PARKING_OPTIONS } from '../shared/master.constants';

/* Full postal address. The table CHECK requires it trimmed and at least 5 characters long. */
const address = z.string().trim().min(5, 'Must be at least 5 characters').max(300, 'Must be at most 300 characters');

/* Same absent / empty semantics as the common optional* validators: absent = leave alone, '' = clear. */
const optionalParking = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.enum(PARKING_OPTIONS, { errorMap: () => ({ message: 'Choose Yes, No or Limited' }) }).nullable().optional(),
);

/* The editable fields, shared by create and update. */
const fields = {
  pinCode: optionalPinCode,
  locationUrl: optionalHttpsUrl(500),
  nearestLandmark: optionalText(200),
  nearestStation: optionalText(200),
  publicTransport: optionalText(200),
  parking: optionalParking,
  remarks: optionalText(500),
};

export const listCentreLocationsSchema = {
  query: listQueryAscSchema(['centreName', 'centreCode', 'createdAt', 'updatedAt'] as const).extend({
    centreId: uuid.optional(),
    parking: z.enum(PARKING_OPTIONS).optional(),
  }),
};

export const centreLocationIdSchema = { params: idParams };

export const createCentreLocationSchema = {
  body: z
    .object({ centreId: uuid, address, ...fields, isActive: z.boolean().optional() })
    .strict(),
};

/*
 * centreId is deliberately absent: the record belongs to its centre for life. .strict() turns an
 * attempt to send it into a 422 instead of silently ignoring it.
 */
export const updateCentreLocationSchema = {
  params: idParams,
  body: z
    .object({ address: address.optional(), ...fields })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
};

export const centreLocationStatusSchema = { params: idParams, body: statusBody };

export type ListCentreLocationsQuery = z.infer<typeof listCentreLocationsSchema.query>;
export type CreateCentreLocationBody = z.infer<typeof createCentreLocationSchema.body>;
export type UpdateCentreLocationBody = z.infer<typeof updateCentreLocationSchema.body>;
