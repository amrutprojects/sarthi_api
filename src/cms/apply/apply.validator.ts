import { z } from 'zod';
import { idParams, statusBody } from '../../shared/validation/common.validation';
import { listQueryAscSchema } from '../../shared/utils/pagination';
import { APPLY_ITEM_KINDS } from './apply.model';

/*
 * Apply page request contract.
 *
 * Mirrors the tables: the same lengths, both halves of every pair required, and an https portal
 * link. The CHECK constraints are the real guarantee; these rules exist so a mistake comes back as a
 * 422 naming the field rather than as a constraint violation.
 */

/* A Marathi/English pair. Both halves are required: a half-translated line is a broken line. */
const bilingual = (max: number, label: string) =>
  z
    .object({
      mr: z.string().trim().min(1, `${label} (Marathi) is required`).max(max, `${label} (Marathi) must be at most ${max} characters`),
      en: z.string().trim().min(1, `${label} (English) is required`).max(max, `${label} (English) must be at most ${max} characters`),
    })
    .strict();

/*
 * An optional Marathi/English pair, for text that may be left out: both halves blank, or both filled. A
 * half-filled pair is still a broken line, so the blank half is reported against its own path.
 */
const optionalBilingual = (max: number, label: string) =>
  z
    .object({
      mr: z.string().trim().max(max, `${label} (Marathi) must be at most ${max} characters`),
      en: z.string().trim().max(max, `${label} (English) must be at most ${max} characters`),
    })
    .strict()
    .superRefine((p, ctx) => {
      if (p.en && !p.mr) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['mr'], message: `${label} (Marathi) is required when the English text is given` });
      if (p.mr && !p.en) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['en'], message: `${label} (English) is required when the Marathi text is given` });
    });

/*
 * A URL that parses (the check z.string().url() makes) and starts with a lower-case https://. Inner
 * whitespace is refused as well: the URL parser silently drops tabs and line breaks, so without this
 * "https://\nhost" would pass here and only fail the CHECK constraint, as an unnamed 400.
 */
const isHttpsUrl = (v: string): boolean => {
  if (!v.startsWith('https://') || /\s/.test(v)) return false;
  try {
    new URL(v);
    return true;
  } catch {
    return false;
  }
};

/*
 * The portal link behind "Apply Now". Required, and https only — the rule of optionalHttpsUrl in
 * shared/validation, because the website puts it straight into an href. Mirrors
 * CHK_apply_page_settings_cta_url. The link check is piped after the length checks so each mistake
 * comes back as exactly one message on `ctaUrl`.
 */
const ctaUrl = z
  .string({ required_error: 'Portal link is required', invalid_type_error: 'Portal link is required' })
  .trim()
  .min(1, 'Portal link is required')
  .max(500, 'Portal link must be at most 500 characters')
  .pipe(z.string().refine(isHttpsUrl, 'Enter a valid https link'));

const kind = z.enum(APPLY_ITEM_KINDS, { errorMap: () => ({ message: 'Type must be STEP or FACT' }) });
const label = bilingual(300, 'Label');
const value = bilingual(2000, 'Value');
const displayOrder = z.coerce
  .number({ invalid_type_error: 'Enter a whole number' })
  .int('Enter a whole number')
  .min(0, 'Display order cannot be negative')
  .max(9999, 'Display order must be at most 9999');

/* ---------------- page text ---------------- */

/* PUT replaces the whole page text: every pair and the link are required, as the page prints every one of them. */
export const updateApplySettingsSchema = {
  body: z
    .object({
      pageTitle: bilingual(200, 'Page title'),
      pageSubtitle: bilingual(500, 'Page subtitle'),
      noteTitle: bilingual(200, 'Note title'),
      noteBody: bilingual(2000, 'Note text'),
      glanceHeading: bilingual(200, 'For Your Information heading'),
      documentsHeading: bilingual(200, 'Documents heading'),
      ctaText: bilingual(1000, 'Call to action text'),
      ctaLabel: bilingual(100, 'Button label'),
      ctaUrl,
      /* The small line under the Apply button: optional, both languages blank to show nothing. */
      ctaHint: optionalBilingual(300, 'Button hint'),
    })
    .strict(),
};

/* ---------------- steps and "At a glance" rows ---------------- */

/* Kind first: the admin list reads one list, then the other, each in the order the website shows them. */
export const listApplyItemsSchema = {
  query: listQueryAscSchema(['kind', 'displayOrder', 'labelEn', 'createdAt', 'updatedAt'] as const).extend({
    kind: kind.optional(),
  }),
};
export const applyItemIdSchema = { params: idParams };

/* Both kinds carry a label and a value: a step's title and description, a fact's label and value. */
export const createApplyItemSchema = {
  body: z
    .object({
      kind,
      label,
      value,
      /* Omitted: the row goes to the end of its own list. */
      displayOrder: displayOrder.optional(),
      isActive: z.boolean().optional(),
    })
    .strict(),
};

/*
 * The kind is not part of the update (it is fixed at creation), and neither is status, which has
 * its own endpoint as on every other CMS master.
 */
export const updateApplyItemSchema = {
  params: idParams,
  body: z
    .object({ label: label.optional(), value: value.optional(), displayOrder: displayOrder.optional() })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
};

export const applyItemStatusSchema = { params: idParams, body: statusBody };

export type UpdateApplySettingsBody = z.infer<typeof updateApplySettingsSchema.body>;
export type ListApplyItemsQuery = z.infer<typeof listApplyItemsSchema.query>;
export type CreateApplyItemBody = z.infer<typeof createApplyItemSchema.body>;
export type UpdateApplyItemBody = z.infer<typeof updateApplyItemSchema.body>;
