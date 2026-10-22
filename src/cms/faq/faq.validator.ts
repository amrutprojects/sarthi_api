import { z } from 'zod';
import { idParams, statusBody } from '../../shared/validation/common.validation';
import { listQueryAscSchema } from '../../shared/utils/pagination';

/*
 * FAQ request contract.
 *
 * Mirrors the table: the same lengths, and both halves of every pair required. The CHECK constraints
 * are the real guarantee; these rules exist so a mistake comes back as a 422 naming the field rather
 * than as a constraint violation.
 */

/* A Marathi/English pair. Both halves are required: a half-translated answer is a broken answer. */
const bilingual = (max: number, label: string) =>
  z
    .object({
      mr: z.string().trim().min(1, `${label} (Marathi) is required`).max(max, `${label} (Marathi) must be at most ${max} characters`),
      en: z.string().trim().min(1, `${label} (English) is required`).max(max, `${label} (English) must be at most ${max} characters`),
    })
    .strict();

const question = bilingual(500, 'Question');
const answer = bilingual(2000, 'Answer');
const displayOrder = z.coerce
  .number({ invalid_type_error: 'Enter a whole number' })
  .int('Enter a whole number')
  .min(0, 'Display order cannot be negative')
  .max(9999, 'Display order must be at most 9999');

/* Display order first: the admin list reads in the order the website shows the questions. */
export const listFaqsSchema = { query: listQueryAscSchema(['displayOrder', 'questionEn', 'createdAt', 'updatedAt'] as const) };
export const faqIdSchema = { params: idParams };

export const createFaqSchema = {
  body: z
    .object({
      question,
      answer,
      /* Omitted: the question goes to the end of the list. */
      displayOrder: displayOrder.optional(),
      isActive: z.boolean().optional(),
    })
    .strict(),
};

/* Status is not part of the update: it has its own endpoint, as on every other CMS master. */
export const updateFaqSchema = {
  params: idParams,
  body: z
    .object({ question: question.optional(), answer: answer.optional(), displayOrder: displayOrder.optional() })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
};

export const faqStatusSchema = { params: idParams, body: statusBody };

export type ListFaqsQuery = z.infer<typeof listFaqsSchema.query>;
export type CreateFaqBody = z.infer<typeof createFaqSchema.body>;
export type UpdateFaqBody = z.infer<typeof updateFaqSchema.body>;
