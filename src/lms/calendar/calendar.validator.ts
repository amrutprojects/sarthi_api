import { z } from 'zod';
import { entityName, idParams, isoDate, optionalUuid, statusBody, uuid } from '../../shared/validation/common.validation';
import { listQueryAscSchema } from '../../shared/utils/pagination';
import { CALENDAR_TYPES, WEEKDAY_CODES, sortWeekdays } from './calendar.constants';
import { LEARNING_CONFIG_MODES } from './learning-config.constants';

/* F-LMS-05-01: 3–80 characters (the catalogue-name character set every master uses). */
const calendarName = entityName({ min: 3, max: 80 });

/* F-LMS-05-05: ≥ 1 of Monday to Sunday, each once; stored Monday→Sunday. No default (none is assumed). */
const workingDays = z
  .array(z.enum(WEEKDAY_CODES, { errorMap: () => ({ message: 'Choose days from Monday to Sunday.' }) }), {
    required_error: 'Select at least one working day.',
  })
  .min(1, 'Select at least one working day.')
  .refine((days) => new Set(days).size === days.length, 'Each working day can be selected only once.')
  .transform(sortWeekdays);

/* F-LMS-05-06: date + name 2–80 characters. */
const holiday = z
  .object({
    date: isoDate,
    name: z
      .string({ required_error: 'Enter the holiday name.' })
      .trim()
      .transform((s) => s.replace(/\s+/g, ' '))
      .pipe(z.string().min(2, 'Must be at least 2 characters').max(80, 'Must be at most 80 characters')),
  })
  .strict();

/* F-LMS-05-06: "unique date per calendar". The period check (date inside it) needs the period: service. */
const holidays = z
  .array(holiday)
  .max(366, 'A calendar year has at most 366 holidays')
  .superRefine((rows, ctx) => {
    const seen = new Set<string>();
    rows.forEach((h, i) => {
      if (seen.has(h.date)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, 'date'], message: 'This date is already a holiday.' });
      seen.add(h.date);
    });
  });

/* F-LMS-05-04: "To later than from". */
const PERIOD_MESSAGE = 'The end date must be after the start date.';
const periodOk = (b: { validFrom?: string; validTo?: string }) => !b.validFrom || !b.validTo || b.validTo > b.validFrom;

export const listLmsCalendarsSchema = {
  query: listQueryAscSchema(['name', 'validFrom', 'validTo', 'createdAt', 'updatedAt'] as const).extend({
    entityId: uuid.optional(),
    centreId: uuid.optional(),
    type: z.enum(CALENDAR_TYPES).optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    /* 'true' lists ONLY the soft-deleted calendars ("Show deleted", restored from the list); default 'false'. */
    deleted: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  }),
};

export const lmsCalendarOptionsSchema = { query: z.object({ entityId: uuid, centreId: uuid.optional() }) };

export const lmsCalendarIdSchema = { params: idParams };

export const createLmsCalendarSchema = {
  body: z
    .object({
      entityId: uuid,
      centreId: optionalUuid,
      name: calendarName,
      validFrom: isoDate,
      validTo: isoDate,
      workingDays,
      holidays: holidays.default([]),
      isActive: z.boolean().optional(),
    })
    .strict()
    .refine(periodOk, { message: PERIOD_MESSAGE, path: ['validTo'] }),
};

/* The entity is fixed after creation; status has its own endpoint; holidays, when sent, replace the whole set. */
export const updateLmsCalendarSchema = {
  params: idParams,
  body: z
    .object({
      centreId: optionalUuid,
      name: calendarName.optional(),
      validFrom: isoDate.optional(),
      validTo: isoDate.optional(),
      workingDays: workingDays.optional(),
      holidays: holidays.optional(),
    })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update')
    .refine(periodOk, { message: PERIOD_MESSAGE, path: ['validTo'] }),
};

export const lmsCalendarStatusSchema = { params: idParams, body: statusBody };

/* ---- Learning configuration (F-LMS-05-07) ---- */

export const learningConfigQuerySchema = { query: z.object({ entityId: uuid }) };

/* The value's type depends on the key: checked by the service against LEARNING_CONFIG_KEYS. */
export const updateLearningConfigSchema = {
  params: z.object({ key: z.string().regex(/^[a-z0-9_.]{2,60}$/, 'Unknown configuration key') }),
  body: z
    .object({
      entityId: uuid,
      mode: z.enum(LEARNING_CONFIG_MODES).optional(),
      value: z.unknown().refine((v) => v !== undefined, 'Enter a value.'),
      reason: z
        .string({ required_error: 'Enter a reason.' })
        .trim()
        .min(1, 'Enter a reason.')
        .max(500, 'Must be at most 500 characters'),
    })
    .strict(),
};

export type ListLmsCalendarsQuery = z.infer<typeof listLmsCalendarsSchema.query>;
export type LmsCalendarOptionsQuery = z.infer<typeof lmsCalendarOptionsSchema.query>;
export type CreateLmsCalendarBody = z.infer<typeof createLmsCalendarSchema.body>;
export type UpdateLmsCalendarBody = z.infer<typeof updateLmsCalendarSchema.body>;
export type LearningConfigQuery = z.infer<typeof learningConfigQuerySchema.query>;
export type UpdateLearningConfigBody = z.infer<typeof updateLearningConfigSchema.body>;
