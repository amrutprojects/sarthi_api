import { z } from 'zod';
import { parentIdParams } from '../../shared/validation/common.validation';
import { LMS_LANGUAGE_CODES } from '../entity/entity.constants';
import { BRANDING_GROUPS, DISPLAY_NAME_MAX, DISPLAY_NAME_MIN, SUPPORT_HOURS_MAX } from './branding.constants';

/*
 * Each key of the settings catalogue validated against its declared type (L-04 "Settings are typed,
 * validated"), with the F-LMS-04 error messages. null resets a key to its default; a required key without
 * a default (support_email) cannot be reset.
 */
const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

/*
 * F-LMS-04-01: 3–60 characters, trimmed, inner whitespace collapsed. Control and invisible format characters
 * (bidi overrides…) are refused; ZWNJ / ZWJ stay, Devanagari spelling needs them.
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const JOINERS = [0x200c, 0x200d].map((c) => String.fromCharCode(c));
const hasUnsafeChar = (s: string) => Array.from(s).some((c) => INVISIBLE.test(c) && !JOINERS.includes(c));
const displayName = z
  .string({ invalid_type_error: 'Enter a display name.' })
  .trim()
  .transform((s) => s.replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(DISPLAY_NAME_MIN, `Enter a display name of at least ${DISPLAY_NAME_MIN} characters.`)
      .max(DISPLAY_NAME_MAX, `Enter a display name of at most ${DISPLAY_NAME_MAX} characters.`)
      .refine((s) => !hasUnsafeChar(s), 'Enter a display name.'),
  );

/* F-LMS-04-03: #RRGGBB, stored upper case. */
const hexColour = z
  .string({ invalid_type_error: 'Enter a valid colour.' })
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Enter a valid colour.')
  .transform((s) => s.toUpperCase());

const colours = z
  .object({
    primary: z.preprocess(blankToNull, hexColour.nullable().optional()),
    accent: z.preprocess(blankToNull, hexColour.nullable().optional()),
  })
  .strict();

/* F-LMS-04-04: a valid email address. Whether it is an organisational mailbox cannot be checked by the server. */
const supportEmail = z
  .string({ required_error: 'Enter a valid email address.', invalid_type_error: 'Enter a valid email address.' })
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.')
  .max(254, 'Enter a valid email address.');

/* F-LMS-04-05: E.164 (+, country code, at most 15 digits); spaces and hyphens typed for readability are dropped. */
const supportPhone = z.preprocess(
  (v) => (typeof v === 'string' ? v.replace(/[\s-]+/g, '') : v),
  z.string({ invalid_type_error: 'Enter a valid phone number.' }).regex(/^\+[1-9]\d{6,14}$/, 'Enter a valid phone number.'),
);

const language = z.enum(LMS_LANGUAGE_CODES, { errorMap: () => ({ message: 'Select a platform language.' }) });

/* Platform-language order, so equal selections are stored identically. */
const inPlatformOrder = (codes: string[]) => LMS_LANGUAGE_CODES.filter((c) => codes.includes(c));

/* F-LMS-04-06: ≤ 120 characters per language; an empty text removes that language's entry. */
const supportHours = z
  .record(language, z.string({ invalid_type_error: 'Shorten the text.' }).trim().max(SUPPORT_HOURS_MAX, 'Shorten the text.'))
  .transform((r) => {
    const out: Record<string, string> = {};
    for (const code of LMS_LANGUAGE_CODES) if (r[code]) out[code] = r[code]!;
    return Object.keys(out).length ? out : null;
  });

/* F-LMS-04-07: ≥ 1 platform languages, each once (the default-language rule needs the entity: service). */
const languages = z
  .array(language, { invalid_type_error: 'Keep at least the default language.' })
  .min(1, 'Keep at least the default language.')
  .refine((codes) => new Set(codes).size === codes.length, 'Each language can be selected only once')
  .transform(inPlatformOrder);

const entityIdParams = parentIdParams('entityId');

export const brandingEntitySchema = { params: entityIdParams };

export const getBrandingSchema = {
  params: entityIdParams,
  query: z.object({
    search: z.string().trim().max(100).optional(),
    group: z.enum(BRANDING_GROUPS).optional(),
  }),
};

/*
 * PUT / PATCH: any subset of the catalogue keys (the logo has its own upload endpoint). Unknown keys are
 * refused, so a setting is never created by a typo.
 */
export const updateBrandingSchema = {
  params: entityIdParams,
  body: z
    .object({
      display_name: z.preprocess(blankToNull, displayName.nullable().optional()),
      colours: colours.nullable().optional(),
      support_email: supportEmail.optional(),
      support_phone: z.preprocess(blankToNull, supportPhone.nullable().optional()),
      support_hours: supportHours.nullable().optional(),
      languages: languages.nullable().optional(),
    })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one setting to update'),
};

export type GetBrandingQuery = z.infer<typeof getBrandingSchema.query>;
export type UpdateBrandingBody = z.infer<typeof updateBrandingSchema.body>;
