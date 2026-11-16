import { z } from 'zod';
import { idParams, statusBody, uuid } from '../../shared/validation/common.validation';
import { clean, displayOrder, expectedUpdatedAt, optionalPair, requiredPair, text } from '../cms.text.validation';

/*
 * Advisory Committee request contract.
 *
 * Mirrors the database: the same lengths and the same "both languages or neither" rule for the
 * position. The CHECK constraints are the real guarantee; these rules exist so a mistake comes back
 * as a 422 naming the field rather than as a constraint violation.
 *
 * Text is normalised and checked by the shared CMS rules (../cms.text.validation.ts).
 */

/*
 * A person's name, in Marathi and in English — always both: the site has no per-field language
 * fallback, so a name in one language only would leave the card nameless for half the visitors.
 * The same character rule as Board Members (board.validator.ts), so a name accepted there is accepted
 * here. Zero-width joiners are allowed: Marathi keyboards use them for forms such as the eyelash र.
 */
const NAME_RE = /^[\p{L}\p{M}](?:[\p{L}\p{M}\p{N} .,'’()/&-]|‌|‍)*$/u;
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
    { required_error: 'Name is required', invalid_type_error: 'Name must have Marathi and English text' },
  )
  .strict();

const isActive = z.boolean({ invalid_type_error: 'Status must be true or false' });

/*
 * The profile behind the website's "View Profile" button. Unlike the position, each field may be
 * filled in Marathi, English, both or neither — long biographies are often available in one language
 * only, and the website falls back to the other language — so there is no both-or-neither rule here.
 */

/* Experience: one paragraph per language. Line breaks are collapsed to spaces like any single-line text. */
const experience = z
  .object(
    { mr: text('Experience (Marathi)', 1000), en: text('Experience (English)', 1000) },
    { invalid_type_error: 'Experience must have Marathi and English text' },
  )
  .strict();

export const MAX_LIST_ITEMS = 30;
export const MAX_LIST_ITEM_LENGTH = 400;

/*
 * The marker a pasted bullet list keeps at the start of a line: "•", or "-", "*", "–", "1." or "1)"
 * (in Western or Marathi digits, "१." / "१)") followed by a space (or nothing). The space is required
 * after all but "•" so that text which merely starts with one of them — "-5 °C", "1.5 lakh trainees",
 * "१.५ लाख" — is kept as written.
 */
const BULLET_RE = /^(?:•|[-*–](?=\s|$)|[0-9०-९]{1,3}[.)](?=\s|$))\s*/u;

/*
 * One received item as the lines it really holds: split on line breaks (an item may never contain
 * one — the list is stored one item per line), whitespace collapsed, one leading bullet marker
 * removed, empty lines dropped. The admin form sends one item per textarea line, but a pasted
 * paragraph of bullets is accepted too.
 */
export const listItems = (v: string): string[] =>
  v
    .split(/\r\n?|\n/)
    .map((line) => clean(false)(line).replace(BULLET_RE, '').trim())
    .filter((line) => line !== '');

/* C0 controls and DEL: line breaks and tabs are gone by now (listItems), so anything left was typed in by mistake. */
const hasControl = (v: string) =>
  [...v].some((ch) => {
    const c = ch.charCodeAt(0);
    return c < 0x20 || c === 0x7f;
  });

/*
 * One language of a profile list: the items in order, normalised as above. An item that is too long
 * is reported at its own index ('body.keyAchievements.en.3'); the item count is checked after blank
 * lines are dropped, so only real items count towards the limit.
 */
const listHalf = (label: string) =>
  z
    .array(
      z
        .string({ invalid_type_error: `${label}: each item must be text` })
        .transform(listItems)
        .superRefine((lines, ctx) => {
          if (lines.some((l) => l.length > MAX_LIST_ITEM_LENGTH))
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${label}: each item must be at most ${MAX_LIST_ITEM_LENGTH} characters`,
            });
          if (lines.some(hasControl))
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} contains characters that are not allowed` });
        }),
      { required_error: `${label} is required`, invalid_type_error: `${label} must be a list of items` },
    )
    .superRefine((items, ctx) => {
      if (items.flat().length > MAX_LIST_ITEMS)
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} may have at most ${MAX_LIST_ITEMS} items` });
    })
    .transform((items) => items.flat());

const listPair = (label: string) =>
  z
    .object(
      { mr: listHalf(`${label} (Marathi)`), en: listHalf(`${label} (English)`) },
      { invalid_type_error: `${label} must have Marathi and English lists` },
    )
    .strict();

/* Every profile key is optional on create and on update: a key left out is blank (create) or unchanged (update). */
const profileFields = {
  experience: experience.optional(),
  administrativeRoles: listPair('Administrative Roles').optional(),
  keyAchievements: listPair('Key Achievements').optional(),
  majorContributions: listPair('Major Contributions').optional(),
  researchLeadership: listPair('Research Leadership').optional(),
  education: listPair('Education').optional(),
};

/* Shown as "Position" in the admin panel: the role and, usually, the institution — one line. */
const designation = optionalPair('Position', 300);

/*
 * The member's group, or null for none. Only the shape is checked here; that the group exists (and is
 * not deleted) is checked by the service, with the same message.
 */
export const CHOOSE_GROUP = 'Choose an existing group';
const groupId = z.string({ invalid_type_error: CHOOSE_GROUP }).uuid(CHOOSE_GROUP).nullable();

/*
 * Create and update accept either a JSON body or multipart/form-data with the same JSON in a `data`
 * field plus an optional `photo` file (see advisory.photo.ts, which unpacks `data` before this runs).
 */
export const createMemberSchema = {
  body: z
    .object({
      name,
      groupId: groupId.optional(),
      designation: designation.optional(),
      ...profileFields,
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
      groupId: groupId.optional(),
      designation: designation.optional(),
      ...profileFields,
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

/*
 * Groups: a heading printed for every visitor, so the name is required in both languages. It is kept
 * as typed (the website prints it in capitals); one live group per English name, checked by the service.
 */
const groupName = requiredPair('Group name', 200);

export const createGroupSchema = {
  body: z.object({ name: groupName, isActive: isActive.optional() }).strict(),
};

export const updateGroupSchema = {
  params: idParams,
  body: z.object({ name: groupName.optional(), isActive: isActive.optional(), expectedUpdatedAt: expectedUpdatedAt.optional() }).strict(),
};

export const groupIdSchema = { params: idParams };

export const groupStatusSchema = { params: idParams, body: statusBody };

/* Every group exactly once, by id — the same rule as the members' order. */
export const groupOrderSchema = {
  body: z
    .object({
      ids: z
        .array(uuid, { required_error: 'ids is required' })
        .min(1, 'ids must list the groups')
        .max(200, 'Too many groups')
        .refine((ids) => new Set(ids).size === ids.length, 'Each group may appear only once'),
    })
    .strict(),
};

export const updateSectionSchema = {
  body: z
    .object({
      heading: requiredPair('Heading', 150),
      subtitle: optionalPair('Subtitle', 300),
      expectedUpdatedAt: expectedUpdatedAt.optional(),
    })
    .strict(),
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
export type CreateGroupBody = z.infer<typeof createGroupSchema.body>;
export type UpdateGroupBody = z.infer<typeof updateGroupSchema.body>;
export type GroupOrderBody = z.infer<typeof groupOrderSchema.body>;
export type PhotoFileParams = z.infer<typeof photoFileSchema.params>;
