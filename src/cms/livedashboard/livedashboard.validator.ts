import { z } from 'zod';
import { idParams, statusBody, uuid } from '../../shared/validation/common.validation';
import { displayOrder, expectedUpdatedAt, optionalPair, requiredPair, text } from '../cms.text.validation';
import { DISTRICT_PROGRESS_STATUSES, LIVE_DASHBOARD_TONES } from './livedashboard.types';

/*
 * The Live Dashboard request contract.
 *
 * Mirrors the database: the same lengths, the same tone and status lists, the same link rule, the
 * same "both languages or neither" rule for the optional texts. The CHECK constraints are the real
 * guarantee; these rules exist so a mistake comes back as a 422 naming the field rather than as a
 * constraint violation. Every text is single-line.
 */

const flag = (label: string) =>
  z.boolean({ required_error: `${label} is required`, invalid_type_error: `${label} must be true or false` });

/* Figures are whole numbers. The ceiling only keeps a typo from overflowing the integer column. */
const count = (label: string, max = 10_000_000) =>
  z
    .number({ required_error: `${label} is required`, invalid_type_error: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .min(0, `${label} must not be negative`)
    .max(max, `${label} must be at most ${max.toLocaleString('en-IN')}`);

/* null, or blank in both languages, is "none" — stored as blank halves. */
const optional = (label: string, max: number) =>
  optionalPair(label, max)
    .nullable()
    .transform((p) => (p && p.mr ? p : null));

/* The figure as printed ('2,000', '87%', '21 / 36'): one short line of text, never blank. */
const value = (max: number) => text('Value', max).refine((v) => v !== '', 'Value is required');

/*
 * Where a card sends the visitor: nowhere ('' or null) or a page of this site ('/programme'). Never
 * an outside address — the cards are the programme's own figures — and never '//host', which a
 * browser reads as another site. Same rule as the CHECK on live_dashboard_cards.link.
 */
const SITE_PATH = /^\/[A-Za-z0-9._~/?=&%#-]*$/;
const cardLink = z
  .custom<string | null>((v) => v === null || typeof v === 'string', { message: 'Link must be text or null' })
  .transform((v) => (v ?? '').trim())
  .superRefine((v, ctx) => {
    if (v.length > 200) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Link must be at most 200 characters' });
    else if (v && (!SITE_PATH.test(v) || v.startsWith('//')))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Link must be a page on this site starting with a single / and use only letters, digits and - _ . ~ / ? = & % #',
      });
  });

const tone = z.enum(LIVE_DASHBOARD_TONES, {
  errorMap: () => ({ message: `Tone must be one of: ${LIVE_DASHBOARD_TONES.join(', ')}` }),
});

const isActive = flag('Status');

/* The whole list in its new order, by id — never by position, so a stale screen cannot move the wrong row. */
const reorder = (what: string) => ({
  body: z
    .object({
      ids: z
        .array(uuid, { required_error: 'ids is required' })
        .min(1, `ids must list the ${what}`)
        .max(999, `Too many ${what}`)
        .refine((ids) => new Set(ids).size === ids.length, `Each of the ${what} may appear only once`),
    })
    .strict(),
});

/*
 * The settings screen saves every field at once. `showSection` is not part of it: the "Show on
 * website" switch (/cms/section-visibility/live-dashboard) is the one writer of that flag, so a
 * settings page opened before the switch was flipped cannot flip it back.
 */
export const updateSettingsSchema = {
  body: z
    .object({
      heading: requiredPair('Heading', 150),
      subtitle: optional('Subtitle', 300).optional(),
      disclaimer: optional('Disclaimer', 300).optional(),
      showDisclaimer: flag('showDisclaimer'),
      mapTitle: requiredPair('Map title', 120),
      showMap: flag('showMap'),
      modesTitle: requiredPair('Training modes title', 120),
      showModes: flag('showModes'),
      offlineLabel: requiredPair('Offline label', 60),
      onlineLabel: requiredPair('Online label', 60),
      offlineCount: count('Offline count'),
      onlineCount: count('Online count'),
      donutCenterLabel: requiredPair('Donut centre label', 40),
      expectedUpdatedAt: expectedUpdatedAt.optional(),
    })
    .strict(),
};

const cardFields = {
  label: requiredPair('Label', 60),
  value: value(20),
  detail: optional('Detail', 120),
  link: cardLink,
  tone,
};

export const createCardSchema = {
  body: z
    .object({
      label: cardFields.label,
      value: cardFields.value,
      detail: cardFields.detail.optional(),
      link: cardFields.link.optional(),
      tone: cardFields.tone.optional(),
      displayOrder: displayOrder.optional(),
      isActive: isActive.optional(),
    })
    .strict(),
};

/* A partial update: only the keys sent are changed, so editing one field can never clear another. */
export const updateCardSchema = {
  params: idParams,
  body: z
    .object({
      label: cardFields.label.optional(),
      value: cardFields.value.optional(),
      detail: cardFields.detail.optional(),
      link: cardFields.link.optional(),
      tone: cardFields.tone.optional(),
      displayOrder: displayOrder.optional(),
      isActive: isActive.optional(),
      expectedUpdatedAt: expectedUpdatedAt.optional(),
    })
    .strict(),
};

const statFields = { label: requiredPair('Label', 80), value: value(30) };

export const createStatSchema = {
  body: z
    .object({
      label: statFields.label,
      value: statFields.value,
      displayOrder: displayOrder.optional(),
      isActive: isActive.optional(),
    })
    .strict(),
};

export const updateStatSchema = {
  params: idParams,
  body: z
    .object({
      label: statFields.label.optional(),
      value: statFields.value.optional(),
      displayOrder: displayOrder.optional(),
      isActive: isActive.optional(),
      expectedUpdatedAt: expectedUpdatedAt.optional(),
    })
    .strict(),
};

export const rowIdSchema = { params: idParams };
export const rowStatusSchema = { params: idParams, body: statusBody };
export const reorderCardsSchema = reorder('cards');
export const reorderStatsSchema = reorder('figures');

/* A district is addressed by its three-letter code ('PUN'), the key the website joins its map tiles on. */
const districtCodeParams = z
  .object({
    code: z
      .string()
      .regex(/^[A-Za-z]{3}$/, 'District code must be three letters')
      .transform((c) => c.toUpperCase()),
  })
  .strict();

/* A partial update of a district's figures; its code and names are fixed. */
export const updateDistrictSchema = {
  params: districtCodeParams,
  body: z
    .object({
      status: z
        .enum(DISTRICT_PROGRESS_STATUSES, {
          errorMap: () => ({ message: `Status must be one of: ${DISTRICT_PROGRESS_STATUSES.join(', ')}` }),
        })
        .optional(),
      target: count('Target').optional(),
      enrolled: count('Enrolled').optional(),
      trainingActive: count('Training active').optional(),
      completed: count('Completed').optional(),
      certified: count('Certified').optional(),
      attendancePct: count('Attendance', 100).optional(),
      expectedUpdatedAt: expectedUpdatedAt.optional(),
    })
    .strict(),
};

export type UpdateSettingsBody = z.infer<typeof updateSettingsSchema.body>;
export type CreateCardBody = z.infer<typeof createCardSchema.body>;
export type UpdateCardBody = z.infer<typeof updateCardSchema.body>;
export type CreateStatBody = z.infer<typeof createStatSchema.body>;
export type UpdateStatBody = z.infer<typeof updateStatSchema.body>;
export type ReorderBody = z.infer<typeof reorderCardsSchema.body>;
export type DistrictCodeParams = z.infer<typeof districtCodeParams>;
export type UpdateDistrictBody = z.infer<typeof updateDistrictSchema.body>;
