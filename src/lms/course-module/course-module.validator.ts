import { z } from 'zod';
import { idParams, optionalText, statusBody, uuid } from '../../shared/validation/common.validation';
import { listQueryAscSchema } from '../../shared/utils/pagination';
import { opensMarkup, richText } from '../course/course.validator';
import { MODULE_NUMBERS, MODULE_STATUSES } from './course-module.constants';

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

/* F-LMS-07-01: 1, 2, 3 or 4. */
const moduleNumber = z.coerce
  .number({ invalid_type_error: 'Select module 1, 2, 3 or 4.' })
  .int('Select module 1, 2, 3 or 4.')
  .refine((n) => (MODULE_NUMBERS as readonly number[]).includes(n), 'Select module 1, 2, 3 or 4.');

/*
 * F-LMS-07-02: 3–160 characters of any text — no character list: the spec's own default is "Module 2: Basic
 * Information Technology Skills" and Table 7's Module 3 title carries an em dash. Trimmed with inner
 * whitespace collapsed (CHK_lms_course_modules_title_trimmed); a title is plain text, so markup and
 * control characters are refused. Length in characters, as PostgreSQL counts them.
 */
const MODULE_TITLE = 'Enter a module title.';
const moduleTitle = z
  .string({ required_error: MODULE_TITLE, invalid_type_error: MODULE_TITLE })
  .trim()
  .transform((s) => s.replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .refine((v) => [...v].length >= 3, MODULE_TITLE)
      .refine((v) => [...v].length <= 160, 'Must be at most 160 characters')
      .refine((v) => !opensMarkup(v) && !/\p{Cc}/u.test(v), 'Enter the title as plain text.'),
  );

/*
 * Hours: decimal > 0 with at most 2 decimals (numeric(6,2)). null clears the value; absent leaves it alone.
 * F-LMS-07-04 / -07 / -08 give no upper bound; 9999.99 is the column's.
 */
const hours = (message: string) =>
  z.preprocess(
    blankToNull,
    z
      .number({ invalid_type_error: message })
      .positive(message)
      .max(9999.99, 'Must be at most 9999.99')
      .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use at most 2 decimals')
      .nullable()
      .optional(),
  );

/* F-LMS-07-07: sessions and session hours are integers > 0. */
const count = (message: string) =>
  z.preprocess(blankToNull, z.number({ invalid_type_error: message }).int(message).positive(message).max(9999, 'Must be at most 9999').nullable().optional());

const hourFields = {
  coreHours: hours('Enter the core hours of the module.'),
  /* F-LMS-07-05: ≤ 120 characters. */
  syllabusRef: optionalText(120),
  sessions: count('Enter a whole number of sessions.'),
  sessionHours: count('Enter whole session hours.'),
  lectureHours: hours('Enter the lecture hours.'),
  practicalHours: hours('Enter the practical hours.'),
  oftHoursMin: hours('Enter a valid OFT hours range.'),
  oftHoursMax: hours('Enter a valid OFT hours range.'),
};

export const listLmsCourseModulesSchema = {
  query: listQueryAscSchema(['moduleNumber', 'title', 'createdAt', 'updatedAt'] as const).extend({
    courseId: uuid.optional(),
    moduleNumber: moduleNumber.optional(),
    status: z.enum(MODULE_STATUSES).optional(),
    /* 'true' lists ONLY the soft-deleted modules ("Show deleted", restored from the list); default 'false'. */
    deleted: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  }),
};

export const lmsCourseModuleOptionsSchema = {
  query: z.object({ courseId: uuid.optional(), moduleNumber: moduleNumber.optional() }).strict(),
};

export const lmsCourseModuleIdSchema = { params: idParams };

/* Status (DRAFT / PUBLISHED / RETIRED) is set through content releases: never part of the body. */
export const createLmsCourseModuleSchema = {
  body: z
    .object({
      courseId: uuid,
      moduleNumber,
      title: moduleTitle,
      /* F-LMS-07-06: ≤ 3,000 characters, sanitised. */
      description: richText(3000, 'Shorten the text.'),
      ...hourFields,
      isActive: z.boolean().optional(),
    })
    .strict(),
};

/* Course and module number are set on creation only (F-LMS-07-01 "Edit … (on creation)"). */
export const updateLmsCourseModuleSchema = {
  params: idParams,
  body: z
    .object({
      title: moduleTitle.optional(),
      description: richText(3000, 'Shorten the text.'),
      ...hourFields,
      /* F-LMS-07-04: "a change needs the syllabus reference and a reason". */
      reason: z.string().trim().min(1, 'Enter a reason.').max(500, 'Must be at most 500 characters').optional(),
    })
    .strict()
    .refine((b) => Object.keys(b).some((k) => k !== 'reason'), 'Provide at least one field to update'),
};

/*
 * POST /prescribed: create the missing prescribed modules of one course. They carry core hours, so the
 * syllabus reference (F-LMS-07-05 "Required with core hours", default "Title of the final syllabus
 * document" — the spec gives no title) is required and stored on each module created.
 */
export const createPrescribedModulesSchema = {
  body: z
    .object({
      courseId: uuid,
      syllabusRef: z
        .string({ required_error: 'Enter the syllabus reference.', invalid_type_error: 'Enter the syllabus reference.' })
        .trim()
        .min(1, 'Enter the syllabus reference.')
        .max(120, 'Must be at most 120 characters'),
    })
    .strict(),
};

export const lmsCourseModuleStatusSchema = { params: idParams, body: statusBody };

export type ListLmsCourseModulesQuery = z.infer<typeof listLmsCourseModulesSchema.query>;
export type LmsCourseModuleOptionsQuery = z.infer<typeof lmsCourseModuleOptionsSchema.query>;
export type CreateLmsCourseModuleBody = z.infer<typeof createLmsCourseModuleSchema.body>;
export type UpdateLmsCourseModuleBody = z.infer<typeof updateLmsCourseModuleSchema.body>;
export type CreatePrescribedModulesBody = z.infer<typeof createPrescribedModulesSchema.body>;
