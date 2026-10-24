import { z } from 'zod';
import { idParams, statusBody, uuid } from '../../shared/validation/common.validation';
import { requiredLink } from '../cms.link.validation';
import { displayOrder, expectedUpdatedAt, optionalPair, requiredPair } from '../cms.text.validation';

/*
 * The Top Bar request contract.
 *
 * Mirrors the database: the same lengths, the same link rule (cms.link.validation.ts), the same "both
 * languages or neither" rule for the optional government name. The CHECK constraints are the real
 * guarantee; these rules exist so a mistake comes back as a 422 naming the field rather than as a
 * constraint violation. Every text is single-line: the strip prints each label on one line.
 */

const fields = {
  label: requiredPair('Label', 40),
  link: requiredLink,
  displayOrder,
  isActive: z.boolean({ invalid_type_error: 'Status must be true or false' }),
};

export const createTopBarLinkSchema = {
  body: z
    .object({
      label: fields.label,
      link: fields.link,
      displayOrder: fields.displayOrder.optional(),
      isActive: fields.isActive.optional(),
    })
    .strict(),
};

/* A partial update: only the keys sent are changed, so editing one field can never clear another. */
export const updateTopBarLinkSchema = {
  params: idParams,
  body: z
    .object({
      label: fields.label.optional(),
      link: fields.link.optional(),
      displayOrder: fields.displayOrder.optional(),
      isActive: fields.isActive.optional(),
      expectedUpdatedAt: expectedUpdatedAt.optional(),
    })
    .strict(),
};

export const topBarLinkIdSchema = { params: idParams };

export const topBarLinkStatusSchema = { params: idParams, body: statusBody };

/* The whole list in its new order, by id — never by position, so a stale screen cannot move the wrong link. */
export const reorderSchema = {
  body: z
    .object({
      ids: z
        .array(uuid, { required_error: 'ids is required' })
        .min(1, 'ids must list the links')
        .max(500, 'Too many links')
        .refine((ids) => new Set(ids).size === ids.length, 'Each link may appear only once'),
    })
    .strict(),
};

/*
 * The government name is sent on every save — a PUT replaces the settings — and is blank in both
 * languages to switch the bold text off. A missing key is refused rather than read as "blank", so a
 * stale client can never wipe the name by omission; null is the same as blank.
 */
const governmentName = z
  .unknown()
  .refine((v) => v !== undefined, 'Government name is required')
  .pipe(optionalPair('Government name', 80).nullable())
  .transform((p) => p ?? { mr: '', en: '' });

export const updateSettingsSchema = {
  body: z
    .object({
      governmentName,
      showLanguageToggle: z.boolean({
        required_error: 'showLanguageToggle is required',
        invalid_type_error: 'showLanguageToggle must be true or false',
      }),
      expectedUpdatedAt: expectedUpdatedAt.optional(),
    })
    .strict(),
};

export type CreateTopBarLinkBody = z.infer<typeof createTopBarLinkSchema.body>;
export type UpdateTopBarLinkBody = z.infer<typeof updateTopBarLinkSchema.body>;
export type ReorderBody = z.infer<typeof reorderSchema.body>;
export type UpdateSettingsBody = z.infer<typeof updateSettingsSchema.body>;
