import { z } from 'zod';
import { idParams, statusBody, uuid } from '../../shared/validation/common.validation';
import { link } from '../cms.link.validation';
import { displayOrder, expectedUpdatedAt, optionalPair, requiredPair } from '../cms.text.validation';

/*
 * The Announcements request contract.
 *
 * Mirrors the database: the same lengths, the same link rule (cms.link.validation.ts), the same "both
 * languages or neither" rule for the optional detail. The CHECK constraints are the real guarantee;
 * these rules exist so a mistake comes back as a 422 naming the field rather than as a constraint
 * violation. Every text is single-line: the ticker prints each announcement on one line.
 */

/* null, or blank in both languages, is an announcement without a detail. */
const detail = optionalPair('Detail', 500)
  .nullable()
  .transform((p) => (p && p.mr ? p : null));

const fields = {
  title: requiredPair('Title', 200),
  detail,
  link,
  displayOrder,
  isActive: z.boolean({ invalid_type_error: 'Status must be true or false' }),
};

export const createAnnouncementSchema = {
  body: z
    .object({
      title: fields.title,
      detail: fields.detail.optional(),
      link: fields.link.optional(),
      displayOrder: fields.displayOrder.optional(),
      isActive: fields.isActive.optional(),
    })
    .strict(),
};

/* A partial update: only the keys sent are changed, so editing one field can never clear another. */
export const updateAnnouncementSchema = {
  params: idParams,
  body: z
    .object({
      title: fields.title.optional(),
      detail: fields.detail.optional(),
      link: fields.link.optional(),
      displayOrder: fields.displayOrder.optional(),
      isActive: fields.isActive.optional(),
      expectedUpdatedAt: expectedUpdatedAt.optional(),
    })
    .strict(),
};

export const announcementIdSchema = { params: idParams };

export const announcementStatusSchema = { params: idParams, body: statusBody };

/* The whole list in its new order, by id — never by position, so a stale screen cannot move the wrong announcement. */
export const reorderSchema = {
  body: z
    .object({
      ids: z
        .array(uuid, { required_error: 'ids is required' })
        .min(1, 'ids must list the announcements')
        .max(500, 'Too many announcements')
        .refine((ids) => new Set(ids).size === ids.length, 'Each announcement may appear only once'),
    })
    .strict(),
};

export const updateSettingsSchema = {
  body: z
    .object({
      label: requiredPair('Label', 60),
      showSection: z.boolean({ required_error: 'showSection is required', invalid_type_error: 'showSection must be true or false' }),
      expectedUpdatedAt: expectedUpdatedAt.optional(),
    })
    .strict(),
};

export type CreateAnnouncementBody = z.infer<typeof createAnnouncementSchema.body>;
export type UpdateAnnouncementBody = z.infer<typeof updateAnnouncementSchema.body>;
export type ReorderBody = z.infer<typeof reorderSchema.body>;
export type UpdateSettingsBody = z.infer<typeof updateSettingsSchema.body>;
