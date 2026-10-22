import { z } from 'zod';
import { idParams, statusBody } from '../../shared/validation/common.validation';
import { listQueryAscSchema } from '../../shared/utils/pagination';
import { ELIGIBILITY_ITEM_KINDS } from './eligibility.model';

/*
 * Eligibility page request contract.
 *
 * Mirrors the tables: the same lengths, both halves of every pair required, and a value exactly
 * when the row is a criterion. The CHECK constraints are the real guarantee; these rules exist so a
 * mistake comes back as a 422 naming the field rather than as a constraint violation.
 */

/* A Marathi/English pair. Both halves are required: a half-translated line is a broken line. */
const bilingual = (max: number, label: string) =>
  z
    .object({
      mr: z.string().trim().min(1, `${label} (Marathi) is required`).max(max, `${label} (Marathi) must be at most ${max} characters`),
      en: z.string().trim().min(1, `${label} (English) is required`).max(max, `${label} (English) must be at most ${max} characters`),
    })
    .strict();

const kind = z.enum(ELIGIBILITY_ITEM_KINDS, { errorMap: () => ({ message: 'Type must be CRITERION or DOCUMENT' }) });
const label = bilingual(300, 'Label');
const value = bilingual(1000, 'Value');
const displayOrder = z.coerce
  .number({ invalid_type_error: 'Enter a whole number' })
  .int('Enter a whole number')
  .min(0, 'Display order cannot be negative')
  .max(9999, 'Display order must be at most 9999');

/* ---------------- page text ---------------- */

/* PUT replaces the whole page text: every pair is required, as the page prints every one of them. */
export const updateEligibilitySettingsSchema = {
  body: z
    .object({
      pageTitle: bilingual(200, 'Page title'),
      pageSubtitle: bilingual(500, 'Page subtitle'),
      criteriaHeading: bilingual(200, 'Criteria heading'),
      documentsHeading: bilingual(200, 'Documents heading'),
      noteTitle: bilingual(200, 'Note title'),
      noteBody: bilingual(2000, 'Note text'),
    })
    .strict(),
};

/* ---------------- criteria and documents ---------------- */

/* Kind first: the admin list reads criteria, then documents, each in the order the website shows them. */
export const listEligibilityItemsSchema = {
  query: listQueryAscSchema(['kind', 'displayOrder', 'labelEn', 'createdAt', 'updatedAt'] as const).extend({
    kind: kind.optional(),
  }),
};
export const eligibilityItemIdSchema = { params: idParams };

/*
 * A criterion needs its value and a document must not carry one. Checked here, on the object, so
 * the 422 names `value` instead of surfacing CHK_eligibility_items_value_by_kind.
 */
export const createEligibilityItemSchema = {
  body: z
    .object({
      kind,
      label,
      value: value.nullable().optional(),
      /* Omitted: the row goes to the end of its own list. */
      displayOrder: displayOrder.optional(),
      isActive: z.boolean().optional(),
    })
    .strict()
    .superRefine((b, ctx) => {
      if (b.kind === 'CRITERION' && !b.value) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'Value is required for an eligibility criterion' });
      }
      if (b.kind === 'DOCUMENT' && b.value) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'A required document does not take a value' });
      }
    }),
};

/*
 * The kind is not part of the update (it is fixed at creation), and neither is status, which has
 * its own endpoint as on every other CMS master. Whether `value` fits the row's kind depends on the
 * stored row, so the service checks it.
 */
export const updateEligibilityItemSchema = {
  params: idParams,
  body: z
    .object({ label: label.optional(), value: value.nullable().optional(), displayOrder: displayOrder.optional() })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
};

export const eligibilityItemStatusSchema = { params: idParams, body: statusBody };

export type UpdateEligibilitySettingsBody = z.infer<typeof updateEligibilitySettingsSchema.body>;
export type ListEligibilityItemsQuery = z.infer<typeof listEligibilityItemsSchema.query>;
export type CreateEligibilityItemBody = z.infer<typeof createEligibilityItemSchema.body>;
export type UpdateEligibilityItemBody = z.infer<typeof updateEligibilityItemSchema.body>;
