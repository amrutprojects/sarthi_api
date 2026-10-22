import { z } from 'zod';
import { idParams, optionalText, statusBody, uuid } from '../../shared/validation/common.validation';
import { listQueryAscSchema } from '../../shared/utils/pagination';
import { isAllowedRichText } from '../course/course.validator';
import {
  COMPETENCY_BANDS, CURRICULUM_STATUSES, EVIDENCE_TYPES, GATE_CLEARANCE_MODES, LEARNING_COMPONENT_KINDS, VARIANT_ASSESSMENT_COMPONENTS,
  VARIANT_OFT_CARDS, VARIANT_PHASES, VARIANT_READINESS_GATES, VARIANT_TRACK_MODULES,
} from './track-variant.constants';

/*
 * Rich text "sanitised" (F-LMS-29-06, F-LMS-32-05 / -07, F-LMS-07-06): the Course master's allow-list
 * (isAllowedRichText) — only paragraphs, bold, italic, lists and https links; any other markup is refused
 * rather than silently rewritten.
 */
const RICH_TEXT_REFUSED = 'Use only paragraphs, bold, italic, lists and https links; remove other markup and scripts.';

/* Required text, trimmed, min–max characters, with the form's error message. */
const text = (min: number, max: number, message: string) =>
  z.string({ required_error: message, invalid_type_error: message }).trim().min(min, message).max(max, message);

const richText = (min: number, max: number, message: string) => text(min, max, message).refine(isAllowedRichText, RICH_TEXT_REFUSED);

const optionalRichText = (max: number, message: string) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().max(max, message).refine(isAllowedRichText, RICH_TEXT_REFUSED).nullable().optional(),
  );

const whole = (min: number, max: number, message: string) =>
  z.number({ required_error: message, invalid_type_error: message }).int(message).min(min, message).max(max, message);

const optionalWhole = (min: number, max: number, message: string) => whole(min, max, message).nullable().optional();

/*
 * At most two decimal places, checked exactly: the number is the one its own two-place form parses back to
 * (2.3, 8.2, 1.15, 0.29 pass; 2.345 and 2.300000001 do not). `Math.round(v * 100) === v * 100` is wrong on
 * binary floats (2.3 * 100 = 229.99999999999997) and refused valid numeric(6,2) / numeric(5,2) values.
 */
const twoDecimals = (v: number) => Number(v.toFixed(2)) === v;

/* Hours: a decimal with at most two places (numeric(6,2)). */
const hours = (message: string) =>
  z
    .number({ required_error: message, invalid_type_error: message })
    .min(0, message)
    .max(9999.99, message)
    .refine(twoDecimals, 'Use at most two decimal places.');

const upperCode = (max: number, pattern: RegExp, message: string) =>
  z.string({ required_error: message }).trim().toUpperCase().pipe(z.string().min(1, message).max(max, message).regex(pattern, message));

const evidenceTypes = z
  .array(z.enum(EVIDENCE_TYPES, { errorMap: () => ({ message: 'Select at least one type of evidence.' }) }), {
    required_error: 'Select at least one type of evidence.',
  })
  .min(1, 'Select at least one type of evidence.')
  .refine((xs) => new Set(xs).size === xs.length, 'Each evidence type can be selected only once.');

const nonEmpty = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object(shape)
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update');

/* ============================== track variant ============================== */

/* F-LMS-07-09: the per-track counts, inside the spec ranges (22 or 23 track modules, 12 or 13 OFT cards). */
const expectedTrackModules = optionalWhole(
  VARIANT_TRACK_MODULES.min,
  VARIANT_TRACK_MODULES.max,
  `Enter ${VARIANT_TRACK_MODULES.min} or ${VARIANT_TRACK_MODULES.max} from the track syllabus.`,
);
const expectedOftCards = optionalWhole(
  VARIANT_OFT_CARDS.min,
  VARIANT_OFT_CARDS.max,
  `Enter ${VARIANT_OFT_CARDS.min} or ${VARIANT_OFT_CARDS.max} from the track syllabus.`,
);

export const listTrackVariantsSchema = {
  query: listQueryAscSchema(['track', 'status', 'createdAt', 'updatedAt'] as const).extend({
    courseId: uuid.optional(),
    courseModuleId: uuid.optional(),
    trackId: uuid.optional(),
    status: z.enum(CURRICULUM_STATUSES).optional(),
    completeness: z.enum(['complete', 'incomplete']).optional(),
    /* 'true' lists ONLY the soft-deleted variants ("Show deleted", restored from the list); default 'false'. */
    deleted: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  }),
};

export const trackVariantOptionsSchema = { query: z.object({ courseModuleId: uuid.optional() }) };

export const trackVariantIdSchema = { params: idParams };

export const createTrackVariantSchema = {
  body: z
    .object({
      courseModuleId: uuid,
      trackId: z.string({ required_error: 'Select a technology track.' }).uuid('Select a technology track.'),
      expectedTrackModules,
      expectedOftCards,
      syllabusReference: optionalText(120),
      description: optionalRichText(3000, 'Shorten the text.'),
      isActive: z.boolean().optional(),
    })
    .strict(),
};

/* The module and track are fixed on creation (F-LMS-07-01 / -03 "on creation"); status has its own endpoints. */
export const updateTrackVariantSchema = {
  params: idParams,
  body: nonEmpty({
    expectedTrackModules,
    expectedOftCards,
    syllabusReference: optionalText(120),
    description: optionalRichText(3000, 'Shorten the text.'),
  }),
};

export const trackVariantStatusSchema = { params: idParams, body: statusBody };

/* ============================== curriculum items ============================== */

export const itemParamsSchema = { params: z.object({ id: uuid, itemId: uuid }) };
export const itemListSchema = { params: idParams };

const phaseNumber = whole(1, VARIANT_PHASES, `Choose a phase number from 1 to ${VARIANT_PHASES}.`);
const phaseFields = {
  title: text(3, 160, 'Enter a phase title of 3 to 160 characters.'),
  description: optionalRichText(3000, 'Shorten the text.'),
};
export const createPhaseSchema = { params: idParams, body: z.object({ phaseNumber, ...phaseFields }).strict() };
/* The phase number is its position: it can be changed while it stays unique. */
export const updatePhaseSchema = {
  params: itemParamsSchema.params,
  body: nonEmpty({ phaseNumber: phaseNumber.optional(), title: phaseFields.title.optional(), description: phaseFields.description }),
};

const trackModuleFields = {
  phaseId: z.string({ required_error: 'Select a phase of this variant.' }).uuid('Select a phase of this variant.'),
  code: upperCode(30, /^[A-Z0-9][A-Z0-9-]*$/, 'Use capital letters, digits and hyphens (up to 30).'),
  title: text(3, 160, 'Enter a track module title of 3 to 160 characters.'),
  sortOrder: whole(1, 999, 'Enter the position of the track module (1 or more).'),
  lectureHours: hours('Enter the lecture hours (0 or more).').nullable().optional(),
  practicalHours: hours('Enter the practical hours (0 or more).').nullable().optional(),
  description: optionalRichText(3000, 'Shorten the text.'),
};
export const createTrackModuleSchema = { params: idParams, body: z.object(trackModuleFields).strict() };
export const updateTrackModuleSchema = {
  params: itemParamsSchema.params,
  body: nonEmpty({
    phaseId: trackModuleFields.phaseId.optional(),
    code: trackModuleFields.code.optional(),
    title: trackModuleFields.title.optional(),
    sortOrder: trackModuleFields.sortOrder.optional(),
    lectureHours: trackModuleFields.lectureHours,
    practicalHours: trackModuleFields.practicalHours,
    description: trackModuleFields.description,
  }),
};

const componentFields = {
  kind: z.enum(LEARNING_COMPONENT_KINDS, { errorMap: () => ({ message: 'Select a kind.' }) }),
  title: text(3, 150, 'Enter a title.'),
  trackModuleId: uuid.nullable().optional(),
  description: optionalRichText(3000, 'Shorten the text.'),
};
export const createComponentSchema = { params: idParams, body: z.object(componentFields).strict() };
export const updateComponentSchema = {
  params: itemParamsSchema.params,
  body: nonEmpty({
    kind: componentFields.kind.optional(),
    title: componentFields.title.optional(),
    trackModuleId: componentFields.trackModuleId,
    description: componentFields.description,
  }),
};

/* F-LMS-29 (Table 55). The track part of the OFT code is checked against the variant's track by the service. */
const oftFields = {
  oftCode: upperCode(20, /^OFT-M3-T\d{2}-\d{2}$/, 'Use the pattern OFT-M3-{track code}-{nn}, for example OFT-M3-T07-04.'),
  title: text(3, 150, 'Enter a title.'),
  stage: optionalText(60),
  linkedTrackModuleId: uuid.nullable().optional(),
  instructions: richText(20, 8000, 'Enter the task instructions.'),
  hoursMin: hours('Enter a valid hours range.').refine((v) => v > 0, 'Enter a valid hours range.'),
  hoursMax: hours('Enter a valid hours range.').refine((v) => v > 0, 'Enter a valid hours range.'),
  deliverable: text(10, 1000, 'Describe the deliverable.'),
  evidenceTypes,
  evidenceNotes: optionalText(2000),
  hostVerificationRequired: z.boolean().default(false),
};
export const createOftCardSchema = {
  params: idParams,
  body: z
    .object(oftFields)
    .strict()
    .refine((b) => b.hoursMin <= b.hoursMax, { message: 'Enter a valid hours range.', path: ['hoursMax'] }),
};
export const updateOftCardSchema = {
  params: itemParamsSchema.params,
  body: nonEmpty({
    oftCode: oftFields.oftCode.optional(),
    title: oftFields.title.optional(),
    stage: oftFields.stage,
    linkedTrackModuleId: oftFields.linkedTrackModuleId,
    instructions: oftFields.instructions.optional(),
    hoursMin: oftFields.hoursMin.optional(),
    hoursMax: oftFields.hoursMax.optional(),
    deliverable: oftFields.deliverable.optional(),
    evidenceTypes: evidenceTypes.optional(),
    evidenceNotes: oftFields.evidenceNotes,
    hostVerificationRequired: z.boolean().optional(),
  }),
};

/* F-LMS-18-10 components[] {code, label, weight, source, indicative}; position 1–10. */
const weight = z
  .number({ invalid_type_error: 'Enter a weight from 0 to 100.' })
  .min(0, 'Enter a weight from 0 to 100.')
  .max(100, 'Enter a weight from 0 to 100.')
  .refine(twoDecimals, 'Use at most two decimal places.');
const assessmentFields = {
  componentCode: upperCode(30, /^[A-Z0-9][A-Z0-9_-]*$/, 'Use capital letters, digits, hyphens and underscores (up to 30).'),
  label: text(2, 150, 'Enter a label.'),
  weight: weight.nullable().optional(),
  source: optionalText(200),
  indicative: z.boolean().optional(),
  sortOrder: whole(1, VARIANT_ASSESSMENT_COMPONENTS, `Choose a position from 1 to ${VARIANT_ASSESSMENT_COMPONENTS}.`),
};
export const createAssessmentComponentSchema = { params: idParams, body: z.object(assessmentFields).strict() };
export const updateAssessmentComponentSchema = {
  params: itemParamsSchema.params,
  body: nonEmpty({
    componentCode: assessmentFields.componentCode.optional(),
    label: assessmentFields.label.optional(),
    weight: assessmentFields.weight,
    source: assessmentFields.source,
    indicative: assessmentFields.indicative,
    sortOrder: assessmentFields.sortOrder.optional(),
  }),
};

/* F-LMS-32 (Table 58). */
const gateFields = {
  gateNumber: whole(1, VARIANT_READINESS_GATES, `Choose a gate number from 1 to ${VARIANT_READINESS_GATES}.`),
  title: text(3, 120, 'Enter a title.'),
  heldAfterTrackModuleId: z.string({ required_error: 'Select a track module of this track.' }).uuid('Select a track module of this track.'),
  demonstration: richText(20, 4000, 'Describe the demonstration.'),
  evidenceTypes,
  evidenceNotes: optionalText(2000),
  remediationPath: richText(10, 2000, 'Describe the remediation path.'),
  clearanceMode: z.enum(GATE_CLEARANCE_MODES, { errorMap: () => ({ message: 'Choose how the gate is cleared.' }) }),
  clearanceMinBand: optionalWhole(COMPETENCY_BANDS.min, COMPETENCY_BANDS.max, 'Choose a minimum band from 1 to 5.'),
};
export const createReadinessGateSchema = {
  params: idParams,
  body: z.object({ ...gateFields, clearanceMode: gateFields.clearanceMode.default('ASSESSOR_DECIDES') }).strict(),
};
/* The gate number is fixed on creation (F-LMS-32-02 "on creation"). */
export const updateReadinessGateSchema = {
  params: itemParamsSchema.params,
  body: nonEmpty({
    title: gateFields.title.optional(),
    heldAfterTrackModuleId: gateFields.heldAfterTrackModuleId.optional(),
    demonstration: gateFields.demonstration.optional(),
    evidenceTypes: evidenceTypes.optional(),
    evidenceNotes: gateFields.evidenceNotes,
    remediationPath: gateFields.remediationPath.optional(),
    clearanceMode: gateFields.clearanceMode.optional(),
    clearanceMinBand: gateFields.clearanceMinBand,
  }),
};

export type ListTrackVariantsQuery = z.infer<typeof listTrackVariantsSchema.query>;
export type CreateTrackVariantBody = z.infer<typeof createTrackVariantSchema.body>;
export type UpdateTrackVariantBody = z.infer<typeof updateTrackVariantSchema.body>;
