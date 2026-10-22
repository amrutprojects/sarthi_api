import { z } from 'zod';
import { idParams, statusBody, uuid } from '../../shared/validation/common.validation';
import { displayOrder, expectedUpdatedAt, requiredPair, text } from '../cms.text.validation';

/*
 * The AMRUT's Impact request contract.
 *
 * Mirrors the database: the same lengths and the same "never blank" rules. The CHECK constraints are
 * the real guarantee; these rules exist so a mistake comes back as a 422 naming the field rather than
 * as a constraint violation.
 */

const flag = (label: string) => z.boolean({ invalid_type_error: `${label} must be true or false` });

const fields = {
  /* The figure as printed ('1,000+', '36'): one short line of text, whitespace collapsed. */
  value: text('Value', 20).refine((v) => v !== '', 'Value is required'),
  label: requiredPair('Label', 80),
  displayOrder,
  isActive: flag('Status'),
};

export const createImpactStatSchema = {
  body: z
    .object({
      value: fields.value,
      label: fields.label,
      displayOrder: fields.displayOrder.optional(),
      isActive: fields.isActive.optional(),
    })
    .strict(),
};

/* A partial update: only the keys sent are changed, so editing one field can never clear another. */
export const updateImpactStatSchema = {
  params: idParams,
  body: z
    .object({
      value: fields.value.optional(),
      label: fields.label.optional(),
      displayOrder: fields.displayOrder.optional(),
      isActive: fields.isActive.optional(),
      expectedUpdatedAt: expectedUpdatedAt.optional(),
    })
    .strict(),
};

export const impactStatIdSchema = { params: idParams };

export const impactStatStatusSchema = { params: idParams, body: statusBody };

/*
 * The whole list in its new order, by id — never by position, so a stale screen cannot move the wrong
 * card. At most 999 cards: the display order is stored as 1..999.
 */
export const reorderSchema = {
  body: z
    .object({
      ids: z
        .array(uuid, { required_error: 'ids is required' })
        .min(1, 'ids must list the cards')
        .max(999, 'Too many cards')
        .refine((ids) => new Set(ids).size === ids.length, 'Each card may appear only once'),
    })
    .strict(),
};

export const updateSectionSchema = {
  body: z
    .object({
      heading: requiredPair('Heading', 120),
      showSection: z.boolean({ required_error: 'showSection is required', invalid_type_error: 'showSection must be true or false' }),
      expectedUpdatedAt: expectedUpdatedAt.optional(),
    })
    .strict(),
};

export type CreateImpactStatBody = z.infer<typeof createImpactStatSchema.body>;
export type UpdateImpactStatBody = z.infer<typeof updateImpactStatSchema.body>;
export type ReorderBody = z.infer<typeof reorderSchema.body>;
export type UpdateSectionBody = z.infer<typeof updateSectionSchema.body>;
