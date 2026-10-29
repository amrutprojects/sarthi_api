import { z } from 'zod';
import { expectedUpdatedAt, optionalPair, text } from '../cms.text.validation';

/*
 * The Brand Bar request contract.
 *
 * Mirrors the database: the same lengths, a title that is never blank, and the "both languages or
 * neither" rule for the partner label. The two full-name lines are separate lines of the bar, not a
 * translation pair, so either may be blank on its own. Every text is single-line: the bar prints each
 * on one line.
 *
 * A PUT replaces the Brand Bar, so every key is required: a missing key is refused rather than read as
 * "blank", and a stale client can never wipe a line by omission.
 */
const fullName = z
  .object(
    { mr: text('Full name (Marathi)', 160), en: text('Full name (English)', 160) },
    { required_error: 'Full name is required', invalid_type_error: 'Full name must have Marathi and English text' },
  )
  .strict();

export const updateBrandBarSchema = {
  body: z
    .object({
      title: text('Title', 60).refine((v) => v !== '', 'Title is required'),
      fullName,
      partnerLabel: z
        .unknown()
        .refine((v) => v !== undefined, 'Partner label is required')
        .pipe(optionalPair('Partner label', 60)),
      partnerName: text('Partner name', 100),
      expectedUpdatedAt: expectedUpdatedAt.optional(),
    })
    .strict(),
};

export type UpdateBrandBarBody = z.infer<typeof updateBrandBarSchema.body>;
