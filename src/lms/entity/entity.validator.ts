import { z } from 'zod';
import { entityName, idParams, optionalText, statusBody, uuid } from '../../shared/validation/common.validation';
import { listQueryAscSchema } from '../../shared/utils/pagination';
import { DEFAULT_TIME_ZONE, LMS_LANGUAGE_CODES, isIanaTimeZone } from './entity.constants';

/* F-LMS-03-01: 3–120 characters (the organisation-name character set every master uses). */
const entityNameSchema = entityName({ min: 3, max: 120 });

/*
 * F-LMS-03-02: A–Z, 0–9 and hyphen, 2–20 characters. Typed lower case is upper-cased, as every master code
 * is. Same shape as CHK_lms_entities_code_upper.
 */
const entityCode = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(
    z
      .string()
      .min(2, 'Must be at least 2 characters')
      .max(20, 'Must be at most 20 characters')
      .regex(/^[A-Z0-9-]+$/, 'Use capital letters, digits and hyphens.'),
  );

/* F-LMS-03-06: one of the platform languages (To Be Confirmed, OQ-023). */
const defaultLanguage = z.enum(LMS_LANGUAGE_CODES, { errorMap: () => ({ message: 'Select a language.' }) });

/* F-LMS-03-07: an IANA zone. */
const timeZone = z.string({ required_error: 'Select a time zone.' }).trim().refine(isIanaTimeZone, 'Select a time zone.');

/* F-LMS-03-04 / -05: a selection of records, by id, each at most once. */
const idSelection = (label: string) =>
  z
    .array(uuid)
    .max(500, `Too many ${label}`)
    .refine((ids) => new Set(ids).size === ids.length, `Each ${label.replace(/s$/, '')} can be selected only once`);

export const listLmsEntitiesSchema = {
  query: listQueryAscSchema(['name', 'code', 'createdAt', 'updatedAt'] as const).extend({
    centreId: uuid.optional(),
    trackId: uuid.optional(),
    /* 'true' lists ONLY the soft-deleted entities ("Show deleted", restored from the list); default 'false'. */
    deleted: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  }),
};

export const lmsEntityIdSchema = { params: idParams };

/* The enabled centres and tracks may be empty at creation: F-LMS-03-04 / -05 require ≥ 1 only before a batch. */
export const createLmsEntitySchema = {
  body: z
    .object({
      name: entityNameSchema,
      code: entityCode,
      description: optionalText(500),
      defaultLanguage,
      timeZone: timeZone.default(DEFAULT_TIME_ZONE),
      centreIds: idSelection('centres').default([]),
      trackIds: idSelection('tracks').default([]),
      isActive: z.boolean().optional(),
    })
    .strict(),
};

/* Status has its own endpoint. centreIds / trackIds, when sent, replace the whole selection. */
export const updateLmsEntitySchema = {
  params: idParams,
  body: z
    .object({
      name: entityNameSchema.optional(),
      code: entityCode.optional(),
      description: optionalText(500),
      defaultLanguage: defaultLanguage.optional(),
      timeZone: timeZone.optional(),
      centreIds: idSelection('centres').optional(),
      trackIds: idSelection('tracks').optional(),
    })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
};

export const lmsEntityStatusSchema = { params: idParams, body: statusBody };

export type ListLmsEntitiesQuery = z.infer<typeof listLmsEntitiesSchema.query>;
export type CreateLmsEntityBody = z.infer<typeof createLmsEntitySchema.body>;
export type UpdateLmsEntityBody = z.infer<typeof updateLmsEntitySchema.body>;
