import { z } from 'zod';
import { idParams, statusBody, uuid } from '../../shared/validation/common.validation';
import { clean, displayOrder, expectedUpdatedAt, optionalPair, requiredPair } from '../cms.text.validation';

/*
 * Board Members request contract.
 *
 * Mirrors the database: the same lengths, the same "both languages or neither" rule for optional
 * text and for the nullable name. The CHECK constraints are the real guarantee; these rules exist so a
 * mistake comes back as a 422 naming the field rather than as a constraint violation.
 *
 * Text is normalised and checked by the shared CMS rules (../cms.text.validation.ts).
 */

/*
 * A person's name, in Marathi and in English. `null` is a deliberate value — "the name is still to be
 * supplied" — and the website then prints no name. A missing key, a blank half or a name in one
 * language only is a mistake, never a name.
 *
 * Zero-width joiners are allowed: Marathi keyboards use them for forms such as the eyelash र.
 */
const NAME_RE = /^[\p{L}\p{M}](?:[\p{L}\p{M}\p{N} .,'’()/&-]|\u200C|\u200D)*$/u;
const NAME_REQUIRED = 'Name is required';
const nameHalf = (label: string) =>
  z
    .string({ required_error: `${label} is required`, invalid_type_error: `${label} must be text` })
    .transform(clean(false))
    .superRefine((v, ctx) => {
      const message = !v
        ? `${label} is required`
        : v.length > 120
          ? `${label} must be at most 120 characters`
          : !NAME_RE.test(v)
            ? `${label} may use letters, digits, spaces and . , ' ( ) - / & only, starting with a letter`
            : null;
      if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    });
const name = z
  .object(
    { mr: nameHalf('Name (Marathi)'), en: nameHalf('Name (English)') },
    {
      required_error: NAME_REQUIRED,
      invalid_type_error: 'Name must have Marathi and English text, or be null while it is not yet available',
    },
  )
  .strict()
  .nullable();

const isActive = z.boolean({ invalid_type_error: 'Status must be true or false' });

const memberFields = {
  name,
  category: requiredPair('Category', 60),
  designation: requiredPair('Designation', 250),
  description: optionalPair('Description', 500, true),
  subtitle: optionalPair('Subtitle', 150),
  displayOrder,
  isActive,
};

/*
 * Create and update accept either a JSON body or multipart/form-data with the same JSON in a `data`
 * field plus an optional `photo` file (see board.photo.ts, which unpacks `data` before this runs).
 */
export const createMemberSchema = {
  body: z
    .object({
      ...memberFields,
      description: memberFields.description.optional(),
      subtitle: memberFields.subtitle.optional(),
      displayOrder: displayOrder.optional(),
      isActive: isActive.optional(),
    })
    .strict(),
};

/* A partial update: only the keys sent are changed, so editing one field can never clear another. */
export const updateMemberSchema = {
  params: idParams,
  body: z
    .object({
      name: name.optional(),
      category: memberFields.category.optional(),
      designation: memberFields.designation.optional(),
      description: memberFields.description.optional(),
      subtitle: memberFields.subtitle.optional(),
      displayOrder: displayOrder.optional(),
      isActive: isActive.optional(),
      removePhoto: z.boolean({ invalid_type_error: 'removePhoto must be true or false' }).optional(),
      expectedUpdatedAt: expectedUpdatedAt.optional(),
    })
    .strict(),
};

export const memberIdSchema = { params: idParams };

export const memberStatusSchema = { params: idParams, body: statusBody };

/* The whole list in its new order, by id — never by position, so a stale screen cannot move the wrong row. */
export const reorderSchema = {
  body: z
    .object({
      ids: z
        .array(uuid, { required_error: 'ids is required' })
        .min(1, 'ids must list the members')
        .max(500, 'Too many members')
        .refine((ids) => new Set(ids).size === ids.length, 'Each member may appear only once'),
    })
    .strict(),
};

export const updateSectionSchema = {
  body: z
    .object({
      heading: requiredPair('Heading', 150),
      subtitle: optionalPair('Subtitle', 300),
      noticeTitle: optionalPair('Notice heading', 150),
      noticeBody: optionalPair('Notice text', 1000, true),
      showNotice: z.boolean({ required_error: 'showNotice is required', invalid_type_error: 'showNotice must be true or false' }),
      expectedUpdatedAt: expectedUpdatedAt.optional(),
    })
    .strict()
    .superRefine((v, ctx) => {
      /* A visible notice box with nothing in it would be an empty yellow band under the cards. */
      if (!v.showNotice) return;
      for (const half of ['mr', 'en'] as const) {
        if (!v.noticeBody[half])
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['noticeBody', half],
            message: `Notice text (${half === 'mr' ? 'Marathi' : 'English'}) is required while the notice is shown`,
          });
      }
    }),
};

/* '<uuid>.jpg' — the only shape a stored photo's file name can have (see the CHECK on "photoKey"). */
export const PHOTO_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export const photoFileSchema = {
  params: z.object({ file: z.string().regex(PHOTO_FILE_RE, 'Not a photo file name') }).strict(),
};

export type CreateMemberBody = z.infer<typeof createMemberSchema.body>;
export type UpdateMemberBody = z.infer<typeof updateMemberSchema.body>;
export type ReorderBody = z.infer<typeof reorderSchema.body>;
export type UpdateSectionBody = z.infer<typeof updateSectionSchema.body>;
export type PhotoFileParams = z.infer<typeof photoFileSchema.params>;
