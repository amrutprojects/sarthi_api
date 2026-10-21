import { z } from 'zod';

const bilingual = (max: number, label: string) =>
  z
    .object({
      mr: z.string().trim().min(1, `${label} (Marathi) is required`).max(max, `${label} (Marathi) must be at most ${max} characters`),
      en: z.string().trim().min(1, `${label} (English) is required`).max(max, `${label} (English) must be at most ${max} characters`),
    })
    .strict();

const score = z.number().int('Must be a whole number').min(0).max(1000);

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

export type UpdateProgrammePageBody = z.infer<typeof updateProgrammePageSchema.body>;
export type ProgrammeStatusBody = z.infer<typeof programmeStatusSchema.body>;
