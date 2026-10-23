import { z } from 'zod';
import { idParams, statusBody, uuid } from '../../shared/validation/common.validation';
import { link } from '../cms.link.validation';
import { displayOrder, expectedUpdatedAt, optionalPair, requiredPair } from '../cms.text.validation';

/*
 * The AMRUT Schemes request contract.
 *
 * Mirrors the database: the same lengths, the same link rule (cms.link.validation.ts), the same date
 * range, the same "both languages or neither" rule for the optional badge and button label. The CHECK
 * constraints are the real guarantee; these rules exist so a mistake comes back as a 422 naming the
 * field rather than as a constraint violation.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/*
 * A calendar day written 'YYYY-MM-DD' — the form a date input submits and the database stores. Checked
 * as a calendar day, never through the server's clock or time zone: 2027-02-30 is refused, and
 * 2027-03-31 is stored as 31 March whatever time zone the request came from.
 */
export function deadlineProblem(v: string): string | null {
  const m = ISO_DATE.exec(v);
  if (!m) return 'Last date must be a date in the format YYYY-MM-DD';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100) return 'Last date must be between the years 2000 and 2100';
  const day = new Date(Date.UTC(y, mo - 1, d));
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) return 'Last date is not a real calendar date';
  return null;
}

/* null (or blank) is a scheme without a last date. */
const deadline = z
  .custom<string | null>((v) => v === null || typeof v === 'string', { message: 'Last date must be a date or null' })
  .transform((v) => (v === null ? null : v.trim() || null))
  .superRefine((v, ctx) => {
    const problem = v === null ? null : deadlineProblem(v);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });

const flag = (label: string) => z.boolean({ invalid_type_error: `${label} must be true or false` });

const fields = {
  title: requiredPair('Scheme title', 150),
  description: requiredPair('Description', 500),
  badge: optionalPair('Badge', 40),
  deadline,
  link,
  buttonLabel: optionalPair('Button label', 60),
  featured: flag('Highlight'),
  displayOrder,
  isActive: flag('Status'),
};

export const createSchemeSchema = {
  body: z
    .object({
      title: fields.title,
      description: fields.description,
      badge: fields.badge.optional(),
      deadline: fields.deadline.optional(),
      link: fields.link.optional(),
      buttonLabel: fields.buttonLabel.optional(),
      featured: fields.featured.optional(),
      displayOrder: fields.displayOrder.optional(),
      isActive: fields.isActive.optional(),
    })
    .strict(),
};

/* A partial update: only the keys sent are changed, so editing one field can never clear another. */
export const updateSchemeSchema = {
  params: idParams,
  body: z
    .object({
      title: fields.title.optional(),
      description: fields.description.optional(),
      badge: fields.badge.optional(),
      deadline: fields.deadline.optional(),
      link: fields.link.optional(),
      buttonLabel: fields.buttonLabel.optional(),
      featured: fields.featured.optional(),
      displayOrder: fields.displayOrder.optional(),
      isActive: fields.isActive.optional(),
      expectedUpdatedAt: expectedUpdatedAt.optional(),
    })
    .strict(),
};

export const schemeIdSchema = { params: idParams };

export const schemeStatusSchema = { params: idParams, body: statusBody };

/* The whole list in its new order, by id — never by position, so a stale screen cannot move the wrong card. */
export const reorderSchema = {
  body: z
    .object({
      ids: z
        .array(uuid, { required_error: 'ids is required' })
        .min(1, 'ids must list the schemes')
        .max(500, 'Too many schemes')
        .refine((ids) => new Set(ids).size === ids.length, 'Each scheme may appear only once'),
    })
    .strict(),
};

export const updateSectionSchema = {
  body: z
    .object({
      heading: requiredPair('Heading', 120),
      subtitle: optionalPair('Subtitle', 300),
      buttonLabel: requiredPair('Default button label', 60),
      showSection: z.boolean({ required_error: 'showSection is required', invalid_type_error: 'showSection must be true or false' }),
      expectedUpdatedAt: expectedUpdatedAt.optional(),
    })
    .strict(),
};

export type CreateSchemeBody = z.infer<typeof createSchemeSchema.body>;
export type UpdateSchemeBody = z.infer<typeof updateSchemeSchema.body>;
export type ReorderBody = z.infer<typeof reorderSchema.body>;
export type UpdateSectionBody = z.infer<typeof updateSectionSchema.body>;
