import { z } from 'zod';
import { idParams, statusBody, uuid } from '../../shared/validation/common.validation';
import { link } from '../cms.link.validation';
import { displayOrder, expectedUpdatedAt, optionalPair, requiredPair } from '../cms.text.validation';
import { isEcosystemIcon } from './ecosystem.icons';

/*
 * The AMRUT Ecosystem request contract.
 *
 * Mirrors the database: the same lengths, the same link rule (cms.link.validation.ts), the same
 * "both languages or neither" rule for the optional link label. The CHECK constraints are the real
 * guarantee; these rules exist so a mistake comes back as a 422 naming the field rather than as a
 * constraint violation.
 */

const icon = z
  .string({ required_error: 'Icon is required', invalid_type_error: 'Icon must be text' })
  .refine(isEcosystemIcon, 'Choose one of the listed icons');

const isActive = z.boolean({ invalid_type_error: 'Status must be true or false' });

const fields = {
  name: requiredPair('Programme name', 80),
  description: requiredPair('Description', 200),
  icon,
  link,
  linkLabel: optionalPair('Link label', 60),
  displayOrder,
  isActive,
};

export const createProgrammeSchema = {
  body: z
    .object({
      name: fields.name,
      description: fields.description,
      icon: fields.icon,
      link: fields.link.optional(),
      linkLabel: fields.linkLabel.optional(),
      displayOrder: fields.displayOrder.optional(),
      isActive: fields.isActive.optional(),
    })
    .strict(),
};

/* A partial update: only the keys sent are changed, so editing one field can never clear another. */
export const updateProgrammeSchema = {
  params: idParams,
  body: z
    .object({
      name: fields.name.optional(),
      description: fields.description.optional(),
      icon: fields.icon.optional(),
      link: fields.link.optional(),
      linkLabel: fields.linkLabel.optional(),
      displayOrder: fields.displayOrder.optional(),
      isActive: fields.isActive.optional(),
      expectedUpdatedAt: expectedUpdatedAt.optional(),
    })
    .strict(),
};

export const programmeIdSchema = { params: idParams };

export const programmeStatusSchema = { params: idParams, body: statusBody };

/* The whole list in its new order, by id — never by position, so a stale screen cannot move the wrong card. */
export const reorderSchema = {
  body: z
    .object({
      ids: z
        .array(uuid, { required_error: 'ids is required' })
        .min(1, 'ids must list the programmes')
        .max(500, 'Too many programmes')
        .refine((ids) => new Set(ids).size === ids.length, 'Each programme may appear only once'),
    })
    .strict(),
};

export const updateSectionSchema = {
  body: z
    .object({
      heading: requiredPair('Heading', 120),
      subtitle: optionalPair('Subtitle', 300),
      linkLabel: requiredPair('Default link label', 60),
      showSection: z.boolean({ required_error: 'showSection is required', invalid_type_error: 'showSection must be true or false' }),
      expectedUpdatedAt: expectedUpdatedAt.optional(),
    })
    .strict(),
};

export type CreateProgrammeBody = z.infer<typeof createProgrammeSchema.body>;
export type UpdateProgrammeBody = z.infer<typeof updateProgrammeSchema.body>;
export type ReorderBody = z.infer<typeof reorderSchema.body>;
export type UpdateSectionBody = z.infer<typeof updateSectionSchema.body>;
