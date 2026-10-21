import { z } from 'zod';

/*
 * Programme section request contract.
 *
 * Mirrors the database: the same lengths, both halves of every pair required. The CHECK
 * constraints are the real guarantee; these rules exist so a mistake comes back as a 422 naming
 * the field rather than as a constraint violation.
 */

/* A Marathi/English pair. Both halves are required: a half-translated section is a broken one. */
const bilingual = (max: number, label: string) =>
  z
    .object({
      mr: z.string().trim().min(1, `${label} (Marathi) is required`).max(max, `${label} (Marathi) must be at most ${max} characters`),
      en: z.string().trim().min(1, `${label} (English) is required`).max(max, `${label} (English) must be at most ${max} characters`),
    })
    .strict();

const objective = z
  .object({
    text: bilingual(400, 'Objective'),
    displayOrder: z.coerce.number().int().min(0).max(999).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const updateHighlightSchema = {
  body: z
    .object({
      heading: bilingual(200, 'Heading'),
      subheading: bilingual(300, 'Subheading'),
      tagline: bilingual(500, 'Tagline'),
      certification: bilingual(300, 'Certification'),
      /* A ticked list with nothing in it is an empty box on the page, so at least one is required. */
      objectives: z
        .array(objective)
        .min(1, 'At least one objective is required')
        .max(20, 'At most 20 objectives'),
      isPublished: z.boolean().optional(),
    })
    .strict(),
};

/* Publish / unpublish on its own, so visibility changes need not resubmit the whole section. */
export const highlightStatusSchema = {
  body: z.object({ isPublished: z.boolean() }).strict(),
};

export type UpdateHighlightBody = z.infer<typeof updateHighlightSchema.body>;
export type HighlightStatusBody = z.infer<typeof highlightStatusSchema.body>;
