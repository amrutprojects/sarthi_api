import { z } from 'zod';
import { optionalPair } from '../cms.text.validation';
import { HIGHLIGHT_ROW_KEYS, type HighlightRowKey } from './highlight.model';

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

/*
 * One fact table row: its show/hide switch, its custom name, or both. An unknown row key is a 422 naming the
 * field, like any other bad input. The body is strict: these two keys and nothing else, at least one of them;
 * a key left out is left as it is.
 *
 * The name follows the shared CMS text rules the Navigation Menu names use (single line, trimmed, no control
 * characters): both languages or neither. `null`, or both blank, resets the row to the website's default name.
 */
export const updateHighlightRowSchema = {
  params: z
    .object({
      key: z.enum(HIGHLIGHT_ROW_KEYS, { errorMap: () => ({ message: `Row must be one of: ${HIGHLIGHT_ROW_KEYS.join(', ')}` }) }),
    })
    .strict(),
  body: z
    .object({
      show: z.boolean({ invalid_type_error: 'show must be true or false' }).optional(),
      label: optionalPair('Name', 40).nullable().optional(),
    })
    .strict()
    .refine((b) => b.show !== undefined || b.label !== undefined, 'Send show, label or both'),
};

export type UpdateHighlightBody = z.infer<typeof updateHighlightSchema.body>;
export type HighlightStatusBody = z.infer<typeof highlightStatusSchema.body>;
export type HighlightRowParams = { key: HighlightRowKey };
export type UpdateHighlightRowBody = z.infer<typeof updateHighlightRowSchema.body>;
