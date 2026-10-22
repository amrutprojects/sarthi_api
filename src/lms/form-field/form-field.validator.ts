import { z } from 'zod';
import { idParams, optionalText, statusBody } from '../../shared/validation/common.validation';
import { listQueryAscSchema } from '../../shared/utils/pagination';
import { LMS_LANGUAGE_CODES } from '../entity/entity.constants';
import {
  CUSTOM_FIELD_TYPES, DEFAULT_CUSTOM_FIELD_TYPE, DEFAULT_REQUIRED_STAGE, DEFAULT_SENSITIVITY, FIELD_CODE_PATTERN, FIELD_SENSITIVITIES,
  HELP_TEXT_MAX, LABEL_MAX, LMS_FORM_CODES, OPTIONS_MAX, OPTION_MAX_LENGTH, REQUIRED_STAGES, SECTION_CODE_PATTERN,
} from './form-field.constants';

const collapse = (s: string) => s.replace(/\s+/g, ' ');

/* F-LMS-FFC-01: a form registered as configurable. */
const formCode = z.enum(LMS_FORM_CODES, { errorMap: () => ({ message: 'Select a form.' }) });

/* F-LMS-FFC-02: the key the value is stored under (lower-case letters, digits, underscore). */
const fieldCode = z
  .string({ required_error: 'Enter a field key.' })
  .trim()
  .regex(FIELD_CODE_PATTERN, 'Use 2–60 lower-case letters, digits and underscores, starting with a letter.');

/* F-LMS-FFC-03: label ≤ 80 (required), help text ≤ 200. */
const label = z
  .string({ required_error: 'Enter a label.' })
  .trim()
  .transform(collapse)
  .pipe(z.string().min(1, 'Enter a label.').max(LABEL_MAX, `Must be at most ${LABEL_MAX} characters`));

/* F-LMS-FFC-03 "per language": label / help text in another platform language (OQ-023 language list). */
const translations = z.record(
  z.enum(LMS_LANGUAGE_CODES, { errorMap: () => ({ message: 'Not a platform language.' }) }),
  z
    .object({
      label: z.string().trim().transform(collapse).pipe(z.string().min(1, 'Enter a label.').max(LABEL_MAX, `Must be at most ${LABEL_MAX} characters`)).optional(),
      helpText: z.string().trim().min(1, 'Enter the help text or leave it out.').max(HELP_TEXT_MAX, `Must be at most ${HELP_TEXT_MAX} characters`).optional(),
    })
    .strict(),
);

/* F-LMS-FFC-08: a section of the form, or a custom section (upper-case code). */
const sectionCode = z
  .string({ required_error: 'Select a section.' })
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(SECTION_CODE_PATTERN, 'Use 1–40 capital letters, digits and underscores, starting with a letter.'));

const sortOrder = z.number({ invalid_type_error: 'Enter a whole number' }).int('Enter a whole number').min(0, 'Must be at least 0').max(100_000, 'Must be at most 100000');

/* F-LMS-FFC-07: the custom data types. */
const dataType = z.enum(CUSTOM_FIELD_TYPES, { errorMap: () => ({ message: 'Select a data type.' }) });

/* Option list of a choice field: each option once (case-insensitive). Which types take options: form-field.rules.ts. */
const options = z
  .array(z.string().trim().transform(collapse).pipe(z.string().min(1, 'Enter the option.').max(OPTION_MAX_LENGTH, `Must be at most ${OPTION_MAX_LENGTH} characters`)))
  .max(OPTIONS_MAX, `At most ${OPTIONS_MAX} options`)
  .refine((o) => new Set(o.map((v) => v.toLowerCase())).size === o.length, 'Each option can be listed only once.')
  .nullable();

/* Typed per data type in the service (form-field.rules.ts), so an update is checked against the merged type. */
const rules = z.record(z.unknown());

const requiredStage = z.enum(REQUIRED_STAGES, { errorMap: () => ({ message: 'Select ON_SAVE or ON_VERIFICATION.' }) });
const sensitivity = z.enum(FIELD_SENSITIVITIES, { errorMap: () => ({ message: 'Select Internal, Personal or Restricted.' }) });

const flag = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

export const listLmsFormFieldsSchema = {
  query: listQueryAscSchema(['position', 'label', 'fieldCode', 'createdAt', 'updatedAt'] as const).extend({
    formCode: formCode.optional(),
    sectionCode: sectionCode.optional(),
    isRequired: flag,
    isVisible: flag,
    isCustom: flag,
    /* 'true' lists only soft-deleted fields (to restore them); default 'false' = the non-deleted ones. */
    deleted: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  }),
};

export const lmsFormFieldIdSchema = { params: idParams };

export const lmsFormCodeSchema = { params: z.object({ formCode }).strict() };

/*
 * 'Add custom field' (F-LMS-FFC-02): standard fields come only from the catalogue (migration seed).
 * Defaults per Table 40: visible on, compulsory off, stage ON_VERIFICATION, type Text, Internal, exportable.
 * sortOrder left out = end of the section.
 */
export const createLmsFormFieldSchema = {
  body: z
    .object({
      formCode,
      fieldCode,
      label,
      helpText: optionalText(HELP_TEXT_MAX),
      translations: translations.default({}),
      sectionCode,
      sortOrder: sortOrder.optional(),
      dataType: dataType.default(DEFAULT_CUSTOM_FIELD_TYPE),
      options: options.optional(),
      rules: rules.default({}),
      isVisible: z.boolean().default(true),
      isRequired: z.boolean().default(false),
      requiredStage: requiredStage.default(DEFAULT_REQUIRED_STAGE),
      sensitivity: sensitivity.default(DEFAULT_SENSITIVITY),
      isExportable: z.boolean().default(true),
      isActive: z.boolean().optional(),
    })
    .strict(),
};

/* Form and field key are the identity of stored values: never changed. Status has its own endpoint. */
export const updateLmsFormFieldSchema = {
  params: idParams,
  body: z
    .object({
      label: label.optional(),
      helpText: optionalText(HELP_TEXT_MAX),
      translations: translations.optional(),
      sectionCode: sectionCode.optional(),
      sortOrder: sortOrder.optional(),
      dataType: dataType.optional(),
      options: options.optional(),
      rules: rules.optional(),
      isVisible: z.boolean().optional(),
      isRequired: z.boolean().optional(),
      requiredStage: requiredStage.optional(),
      sensitivity: sensitivity.optional(),
      isExportable: z.boolean().optional(),
    })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
};

export const lmsFormFieldStatusSchema = { params: idParams, body: statusBody };

export type ListLmsFormFieldsQuery = z.infer<typeof listLmsFormFieldsSchema.query>;
export type CreateLmsFormFieldBody = z.infer<typeof createLmsFormFieldSchema.body>;
export type UpdateLmsFormFieldBody = z.infer<typeof updateLmsFormFieldSchema.body>;
