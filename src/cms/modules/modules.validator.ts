import { z } from 'zod';
import { MODULE_KINDS } from './modules.model';

/*
 * Modules page request contract.
 *
 * Mirrors the database exactly: the same lengths, the same arithmetic, the same uniqueness. The
 * CHECK constraints are the real guarantee; these rules exist so a mistake comes back as a 422
 * naming the field rather than as a constraint violation.
 */

/* A Marathi/English pair. Both halves are required: a half-translated page is a broken page. */
const bilingual = (max: number, label: string) =>
  z
    .object({
      mr: z
        .string()
        .trim()
        .min(1, `${label} (Marathi) is required`)
        .max(max, `${label} (Marathi) must be at most ${max} characters`),
      en: z
        .string()
        .trim()
        .min(1, `${label} (English) is required`)
        .max(max, `${label} (English) must be at most ${max} characters`),
    })
    .strict();

const certificate = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(300, `${label} must be at most 300 characters`);

const count = (label: string, max: number) =>
  z.coerce.number().int().min(0, `${label} cannot be negative`).max(max, `${label} is too large`);

const electiveDomain = z
  .object({
    no: count('Domain number', 999),
    domain: bilingual(200, 'Domain name'),
    certificate: certificate('Certificate'),
    displayOrder: count('Display order', 999).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

/*
 * One module's timetable.
 *
 * Training plus assessment must equal the module total — the programme's own arithmetic, now
 * checked per module. A module that contradicts itself is worse than one that refuses to save.
 */
const timeSplit = z
  .object({
    moduleHours: count('Module hours', 9999),
    trainingHours: count('Training hours', 9999),
    assessmentHours: count('Assessment hours', 9999),
    weeksPerModule: count('Weeks per module', 999),
    daysPerWeek: count('Days per week', 7),
    hoursPerDay: count('Hours per day', 24),
    weeklyAssessmentHours: z.coerce
      .number()
      .min(0, 'Weekly assessment hours cannot be negative')
      .max(168, 'Weekly assessment hours is too large'),
  })
  .strict()
  .superRefine((t, ctx) => {
    if (t.trainingHours + t.assessmentHours !== t.moduleHours) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['moduleHours'],
        message: `Training (${t.trainingHours}) and assessment (${t.assessmentHours}) must add up to the module total (${t.moduleHours})`,
      });
    }
  });

const moduleItem = z
  .object({
    no: count('Module number', 99),
    code: z
      .string()
      .trim()
      .min(1, 'Module code is required')
      .max(32, 'Module code must be at most 32 characters'),
    kind: z.enum(MODULE_KINDS),
    name: bilingual(300, 'Module name'),
    description: bilingual(600, 'Module description'),
    timeSplit,
    displayOrder: count('Display order', 999).optional(),
    /* For an elective this is the "show it and count it" tick box. */
    isActive: z.boolean().optional(),
    /* This module's own domains. Every module carries its own list. */
    electives: z
      .array(electiveDomain)
      .max(50, 'At most 50 employment domains per module')
      .optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    /* The number is how a domain is listed in this module's table, so it cannot repeat. */
    const seen = new Set<number>();
    (m.electives ?? []).forEach((d, index) => {
      if (seen.has(d.no)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['electives', index, 'no'],
          message: `Duplicate domain number ${d.no}`,
        });
      }
      seen.add(d.no);
    });
  });

/* The two shares of the learning-path donut. A chart whose shares do not total 100 misstates it. */
const learningPath = z
  .object({
    sessionLength: bilingual(40, 'Session length'),
    sessionLabel: bilingual(80, 'Session label'),
    fixedPathPct: count('Fixed-path share', 100),
    selfPathPct: count('Self-path share', 100),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.fixedPathPct + p.selfPathPct !== 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fixedPathPct'],
        message: `The two shares must add up to 100 (currently ${p.fixedPathPct + p.selfPathPct})`,
      });
    }
  });

export const updateModulesPageSchema = {
  body: z
    .object({
      pageTitle: bilingual(200, 'Page title'),
      pageSubtitle: bilingual(500, 'Page subtitle'),

      modules: z
        .array(moduleItem)
        .min(1, 'At least one module is required')
        .max(12, 'At most 12 modules')
        .superRefine((list, ctx) => {
          /* The code identifies a module across the site, so it cannot repeat. */
          const seen = new Set<string>();
          list.forEach((m, index) => {
            const code = m.code.trim().toUpperCase();
            if (seen.has(code)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [index, 'code'],
                message: `Duplicate module code ${m.code}`,
              });
            }
            seen.add(code);
          });
        }),

      learningPath,
      isPublished: z.boolean().optional(),
    })
    .strict(),
};

/* Publish / unpublish on its own, so visibility changes need not resubmit the whole page. */
export const modulesStatusSchema = {
  body: z.object({ isPublished: z.boolean() }).strict(),
};

export type UpdateModulesPageBody = z.infer<typeof updateModulesPageSchema.body>;
export type ModulesStatusBody = z.infer<typeof modulesStatusSchema.body>;
