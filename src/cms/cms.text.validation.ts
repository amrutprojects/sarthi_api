import { z } from 'zod';

/*
 * Request rules for the bilingual text the CMS sections store (Board Members, The AMRUT Ecosystem).
 *
 * Text is normalised before it is checked: single-line fields have their whitespace collapsed (so a
 * pasted line break cannot split a badge or a card title), multi-line fields keep their line breaks,
 * and control characters are refused everywhere. Nothing is ever rendered as HTML — the website and
 * the admin panel print these strings as text — so angle brackets and quotes are kept as typed.
 */

/* C0 controls and DEL, other than the line break that multi-line text keeps (clean() has dealt with the rest). */
const hasControl = (v: string) =>
  [...v].some((ch) => {
    const c = ch.charCodeAt(0);
    return (c < 0x20 && c !== 0x0a) || c === 0x7f;
  });

export const clean = (multiline: boolean) => (v: string) =>
  multiline ? v.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : v.replace(/\s+/g, ' ').trim();

export const text = (label: string, max: number, multiline = false) =>
  z
    .string({ required_error: `${label} is required`, invalid_type_error: `${label} must be text` })
    .transform(clean(multiline))
    .superRefine((v, ctx) => {
      if (v.length > max) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be at most ${max} characters` });
      if (hasControl(v)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} contains characters that are not allowed` });
    });

/* A pair shown on the website in both languages: both halves required. */
export const requiredPair = (label: string, max: number, multiline = false) =>
  z
    .object(
      {
        mr: text(`${label} (Marathi)`, max, multiline).refine((v) => v !== '', `${label} (Marathi) is required`),
        en: text(`${label} (English)`, max, multiline).refine((v) => v !== '', `${label} (English) is required`),
      },
      { required_error: `${label} is required`, invalid_type_error: `${label} must have Marathi and English text` },
    )
    .strict();

/*
 * Optional text: blank in both languages (the line is left out, or a default is used), or filled in
 * both. The site has no per-field language fallback, so a pair filled in one language prints an empty
 * line for half the visitors.
 */
export const optionalPair = (label: string, max: number, multiline = false) =>
  z
    .object(
      { mr: text(`${label} (Marathi)`, max, multiline), en: text(`${label} (English)`, max, multiline) },
      { invalid_type_error: `${label} must have Marathi and English text` },
    )
    .strict()
    .superRefine((p, ctx) => {
      if (p.mr && !p.en)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['en'], message: `${label} (English) is required when the Marathi text is filled in` });
      if (p.en && !p.mr)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['mr'], message: `${label} (Marathi) is required when the English text is filled in` });
    });

export const expectedUpdatedAt = z.string().datetime({ offset: true, message: 'expectedUpdatedAt must be an ISO-8601 date and time' });

export const displayOrder = z
  .number({ invalid_type_error: 'Display order must be a number' })
  .int('Display order must be a whole number')
  .min(1, 'Display order must be at least 1')
  .max(999, 'Display order must be at most 999');
