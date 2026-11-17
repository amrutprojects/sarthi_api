import { z } from 'zod';
import { PROGRAMME_FACT_KEYS, type ProgrammeFactKey } from './programme.model';

const bilingual = (max: number, label: string) =>
  z
    .object({
      mr: z.string().trim().min(1, `${label} (Marathi) is required`).max(max, `${label} (Marathi) must be at most ${max} characters`),
      en: z.string().trim().min(1, `${label} (English) is required`).max(max, `${label} (English) must be at most ${max} characters`),
    })
    .strict();

const score = z.number().int('Must be a whole number').min(0).max(1000);

/* Same rule and wording as the other CMS figures (modules.validator.ts). */
const count = (label: string, max: number) =>
  z.coerce.number().int().min(0, `${label} cannot be negative`).max(max, `${label} is too large`);

/*
 * A whole number of months, or two joined by a hyphen, en dash or em dash with optional spaces around it ("4-6",
 * "4 – 6"). No leading zeros, except 0 itself. ASCII digits only.
 */
const MONTHS = /^(0|[1-9][0-9]*)(?:\s*[-–—]\s*(0|[1-9][0-9]*))?$/;

/*
 * A number of months or a range of them (Ideal duration, Validity). Each number runs 0 to max, and a range must run
 * from the smaller to the larger ("6-4" and "4-4" are refused). Normalised to "N" or "N-M" (ASCII hyphen, no spaces):
 * the form stored, returned, and admitted by the columns' CHECKs (ProgrammeMonthRanges migration). A JSON number, as an
 * older admin screen sends, is taken as its string form (6 -> "6") and checked the same way.
 */
const months = (label: string, max: number) => {
  const invalid = `${label} must be a number of months or a range such as 4-6`;
  return z.preprocess(
    (v) => (typeof v === 'number' ? String(v) : v),
    z
      .string({ required_error: `${label} is required`, invalid_type_error: invalid })
      .trim()
      .transform((v, ctx) => {
        const m = MONTHS.exec(v);
        if (!m) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: invalid });
          return z.NEVER;
        }
        const from = Number(m[1]);
        const to = m[2] === undefined ? undefined : Number(m[2]);
        if (from > max || (to !== undefined && to > max)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} is too large` });
          return z.NEVER;
        }
        if (to !== undefined && from >= to) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label}: enter the smaller number first, e.g. 4-6` });
          return z.NEVER;
        }
        return to === undefined ? `${from}` : `${from}-${to}`;
      }),
  );
};

/* The fact sheet. Total hours, the module line and the elective count are summed from the modules, never entered. */
const facts = z
  .object({
    idealMonths: months('Ideal duration', 120),
    validityMonths: months('Validity', 240),
    securityDeposit: count('Security deposit', 10_000_000),
    applyLeadDays: count('Apply before', 365),
    partnerName: z.string().trim().min(1, 'Partner name is required').max(150, 'Partner name must be at most 150 characters'),
  })
  .strict();

/* The whole Programme page, as the admin screen submits it. Order of every list is the order shown on the site. */
export const updateProgrammePageSchema = {
  body: z
    .object({
      intro: bilingual(500, 'Introduction'),
      objectives: z.array(bilingual(300, 'Objective')).min(1, 'Add at least one objective').max(20),
      methodology: z
        .array(z.object({ label: bilingual(80, 'Label'), value: bilingual(300, 'Description') }).strict())
        .min(1, 'Add at least one methodology row')
        .max(20),
      assessment: z
        .array(z.object({ component: bilingual(150, 'Component'), min: score, max: score }).strict())
        .min(1, 'Add at least one assessment row')
        .max(10),
      assessmentNote: bilingual(500, 'Assessment note'),
      certification: z.array(bilingual(300, 'Certification point')).min(1, 'Add at least one certification point').max(20),
      trainingModes: z
        .object({
          title: bilingual(150, 'Heading'),
          modes: z
            .array(z.object({ name: bilingual(60, 'Mode name'), description: bilingual(500, 'Mode description') }).strict())
            .min(1, 'Add at least one training mode')
            .max(6),
          note: bilingual(500, 'Note'),
        })
        .strict(),
      facts,
      isPublished: z.boolean().optional(),
    })
    .strict()
    .superRefine((b, ctx) => {
      b.assessment.forEach((row, i) => {
        if (row.min > row.max)
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['assessment', i, 'min'], message: 'Minimum cannot be more than the total' });
        if (row.max < 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['assessment', i, 'max'], message: 'Total must be at least 1' });
      });
    }),
};

export const programmeStatusSchema = { body: z.object({ isPublished: z.boolean() }).strict() };

/* One fact sheet row's show/hide switch. An unknown row key is a 422 naming the field, like any other bad input. */
export const programmeFactVisibilitySchema = {
  params: z
    .object({
      key: z.enum(PROGRAMME_FACT_KEYS, { errorMap: () => ({ message: `Fact must be one of: ${PROGRAMME_FACT_KEYS.join(', ')}` }) }),
    })
    .strict(),
  /* Strict: this endpoint writes the switch and nothing else. */
  body: z.object({ show: z.boolean({ required_error: 'show is required', invalid_type_error: 'show must be true or false' }) }).strict(),
};

export type UpdateProgrammePageBody = z.infer<typeof updateProgrammePageSchema.body>;
export type ProgrammeStatusBody = z.infer<typeof programmeStatusSchema.body>;
export type ProgrammeFactParams = { key: ProgrammeFactKey };
export type ProgrammeFactVisibilityBody = z.infer<typeof programmeFactVisibilitySchema.body>;
