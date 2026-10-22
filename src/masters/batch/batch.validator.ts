import { z } from 'zod';
import {
  entityName, idParams, isoDate, optionalIsoDate, optionalText, statusBody, uuid, wholeNumber,
} from '../../shared/validation/common.validation';
import { listQueryAscSchema } from '../../shared/utils/pagination';
import { BATCH_STATUSES, DELIVERY_MODES } from '../shared/master.constants';

/*
 * A batch code: 2 to 30 characters of A–Z, 0–9 and hyphen, starting with a letter or a digit, stored upper
 * case (AMK-B-TC0001-001). The same shape is a CHECK constraint on the table.
 */
const batchCode = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(
    z
      .string()
      .min(2, 'Must be at least 2 characters')
      .max(30, 'Must be at most 30 characters')
      .regex(/^[A-Z0-9][A-Z0-9-]{1,29}$/, 'Use A–Z, 0–9 and hyphen, starting with a letter or digit'),
  );

/*
 * The code is optional: absent leaves it alone (update), empty or null asks the server to generate one.
 * Same "undefined = not sent, null = cleared" convention as the optional* validators.
 */
const optionalBatchCode = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  batchCode.nullable().optional(),
);

const batchName = entityName({ max: 100 });
const capacity = wholeNumber(1, 100000);

export const listBatchesSchema = {
  query: listQueryAscSchema(['name', 'code', 'centreName', 'startDate', 'capacity', 'batchStatus', 'createdAt', 'updatedAt'] as const).extend({
    centreId: uuid.optional(),
    batchStatus: z.enum(BATCH_STATUSES).optional(),
    deliveryMode: z.enum(DELIVERY_MODES).optional(),
  }),
};

/* ?assignable=true narrows the feed to the batches Assign Batch may use (OPEN, centre active). */
export const batchOptionsSchema = {
  query: z
    .object({
      assignable: z
        .enum(['true', 'false'])
        .transform((v) => v === 'true')
        .optional(),
    })
    .strict(),
};

export const batchIdSchema = { params: idParams };

/* endDate > startDate is checked by the service (it needs the stored dates on update) and answered with a 400. */
export const createBatchSchema = {
  body: z
    .object({
      centreId: uuid,
      name: batchName,
      code: optionalBatchCode,
      trackName: optionalText(100),
      capacity,
      startDate: isoDate,
      endDate: optionalIsoDate,
      deliveryMode: z.enum(DELIVERY_MODES),
      batchStatus: z.enum(BATCH_STATUSES).optional(),
      isActive: z.boolean().optional(),
    })
    .strict(),
};

/*
 * centreId and code may be changed only while no student is assigned to the batch; the service enforces
 * that, re-validates a new centre, and re-checks the name against the centre the batch ends up in.
 */
export const updateBatchSchema = {
  params: idParams,
  body: z
    .object({
      centreId: uuid.optional(),
      name: batchName.optional(),
      code: optionalBatchCode,
      trackName: optionalText(100),
      capacity: capacity.optional(),
      startDate: isoDate.optional(),
      endDate: optionalIsoDate,
      deliveryMode: z.enum(DELIVERY_MODES).optional(),
      batchStatus: z.enum(BATCH_STATUSES).optional(),
    })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
};

export const batchStatusSchema = { params: idParams, body: statusBody };

export type ListBatchesQuery = z.infer<typeof listBatchesSchema.query>;
export type BatchOptionsQuery = z.infer<typeof batchOptionsSchema.query>;
export type CreateBatchBody = z.infer<typeof createBatchSchema.body>;
export type UpdateBatchBody = z.infer<typeof updateBatchSchema.body>;
