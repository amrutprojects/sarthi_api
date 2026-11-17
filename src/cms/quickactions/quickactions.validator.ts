import { z } from 'zod';
import { idParams, statusBody, uuid } from '../../shared/validation/common.validation';
import { requiredLink } from '../cms.link.validation';
import { displayOrder, expectedUpdatedAt, optionalPair, requiredPair } from '../cms.text.validation';
import { isQuickActionIcon } from './quickactions.icons';

/*
 * The Quick Actions request contract.
 *
 * Mirrors the database: the same lengths, the same icon list (quickactions.icons.ts), the same link
 * rule (cms.link.validation.ts), the same "both languages or neither" rule for the optional subtitle.
 * The CHECK constraints are the real guarantee; these rules exist so a mistake comes back as a 422
 * naming the field rather than as a constraint violation. Every text is single-line: a tile prints its
 * title and subtitle on one line each.
 */

const icon = z
  .string({ required_error: 'Icon is required', invalid_type_error: 'Icon must be text' })
  .refine(isQuickActionIcon, 'Choose one of the listed icons');

/* null, or blank in both languages, is a tile without a subtitle. */
const subtitle = optionalPair('Subtitle', 60)
  .nullable()
  .transform((p) => (p && p.mr ? p : null));

const fields = {
  title: requiredPair('Title', 40),
  subtitle,
  icon,
  link: requiredLink,
  displayOrder,
  isActive: z.boolean({ invalid_type_error: 'Status must be true or false' }),
};

export const createQuickActionSchema = {
  body: z
    .object({
      title: fields.title,
      subtitle: fields.subtitle.optional(),
      icon: fields.icon,
      link: fields.link,
      displayOrder: fields.displayOrder.optional(),
      isActive: fields.isActive.optional(),
    })
    .strict(),
};

/* A partial update: only the keys sent are changed, so editing one field can never clear another. */
export const updateQuickActionSchema = {
  params: idParams,
  body: z
    .object({
      title: fields.title.optional(),
      subtitle: fields.subtitle.optional(),
      icon: fields.icon.optional(),
      link: fields.link.optional(),
      displayOrder: fields.displayOrder.optional(),
      isActive: fields.isActive.optional(),
      expectedUpdatedAt: expectedUpdatedAt.optional(),
    })
    .strict(),
};

export const quickActionIdSchema = { params: idParams };

export const quickActionStatusSchema = { params: idParams, body: statusBody };

/* The whole list in its new order, by id — never by position, so a stale screen cannot move the wrong tile. */
export const reorderSchema = {
  body: z
    .object({
      ids: z
        .array(uuid, { required_error: 'ids is required' })
        .min(1, 'ids must list the quick actions')
        .max(500, 'Too many quick actions')
        .refine((ids) => new Set(ids).size === ids.length, 'Each quick action may appear only once'),
    })
    .strict(),
};

export type CreateQuickActionBody = z.infer<typeof createQuickActionSchema.body>;
export type UpdateQuickActionBody = z.infer<typeof updateQuickActionSchema.body>;
export type ReorderBody = z.infer<typeof reorderSchema.body>;
