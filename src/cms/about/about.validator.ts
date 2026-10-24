import { z } from 'zod';
import { idParams, statusBody, uuid } from '../../shared/validation/common.validation';
import { displayOrder, expectedUpdatedAt, optionalPair, requiredPair } from '../cms.text.validation';

/*
 * About AMRUT request contract.
 *
 * Mirrors the database: the same lengths and the same rules — both languages for every text, a
 * subtitle blank in both or filled in both. The CHECK constraints are the real guarantee; these
 * rules exist so a mistake comes back as a 422 naming the field rather than as a constraint
 * violation. Text is normalised by the shared CMS rules (../cms.text.validation.ts); the description
 * and card texts keep their line breaks.
 */

const isActive = z.boolean({ invalid_type_error: 'Status must be true or false' });

/* A partial update of the section: only the keys sent change. */
export const updateSectionSchema = {
  body: z
    .object({
      heading: requiredPair('Heading', 120).optional(),
      subtitle: optionalPair('Subtitle', 300).optional(),
      description: requiredPair('Description', 4000, true).optional(),
      showSection: z.boolean({ invalid_type_error: 'showSection must be true or false' }).optional(),
      expectedUpdatedAt: expectedUpdatedAt.optional(),
    })
    .strict()
    .refine(
      (v) => v.heading !== undefined || v.subtitle !== undefined || v.description !== undefined || v.showSection !== undefined,
      'Send at least one of heading, subtitle, description or showSection',
    ),
};

const factFields = { label: requiredPair('Label', 80), value: requiredPair('Value', 500) };
const cardFields = { heading: requiredPair('Card heading', 80), description: requiredPair('Card description', 1000, true) };

export const createFactSchema = {
  body: z.object({ ...factFields, displayOrder: displayOrder.optional(), isActive: isActive.optional() }).strict(),
};

/* A partial update: only the keys sent change, so editing one field can never clear another. */
export const updateFactSchema = {
  params: idParams,
  body: z
    .object({
      label: factFields.label.optional(),
      value: factFields.value.optional(),
      displayOrder: displayOrder.optional(),
      isActive: isActive.optional(),
      expectedUpdatedAt: expectedUpdatedAt.optional(),
    })
    .strict(),
};

export const createCardSchema = {
  body: z.object({ ...cardFields, displayOrder: displayOrder.optional(), isActive: isActive.optional() }).strict(),
};

export const updateCardSchema = {
  params: idParams,
  body: z
    .object({
      heading: cardFields.heading.optional(),
      description: cardFields.description.optional(),
      displayOrder: displayOrder.optional(),
      isActive: isActive.optional(),
      expectedUpdatedAt: expectedUpdatedAt.optional(),
    })
    .strict(),
};

export const itemIdSchema = { params: idParams };

export const itemStatusSchema = { params: idParams, body: statusBody };

/* The whole list in its new order, by id — never by position, so a stale screen cannot move the wrong record. */
export const reorderSchema = {
  body: z
    .object({
      ids: z
        .array(uuid, { required_error: 'ids is required' })
        .min(1, 'ids must list the records')
        .max(500, 'Too many records')
        .refine((ids) => new Set(ids).size === ids.length, 'Each record may appear only once'),
    })
    .strict(),
};

export type UpdateSectionBody = z.infer<typeof updateSectionSchema.body>;
export type CreateFactBody = z.infer<typeof createFactSchema.body>;
export type UpdateFactBody = z.infer<typeof updateFactSchema.body>;
export type CreateCardBody = z.infer<typeof createCardSchema.body>;
export type UpdateCardBody = z.infer<typeof updateCardSchema.body>;
export type ReorderBody = z.infer<typeof reorderSchema.body>;
