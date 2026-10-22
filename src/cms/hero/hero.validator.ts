import { z } from 'zod';

/*
 * Home hero request contract.
 *
 * Mirrors the database: the same lengths, both halves of every pair required, the same link rule.
 * The CHECK constraints are the real guarantee; these rules exist so a mistake comes back as a 422
 * naming the field rather than as a constraint violation.
 */

/*
 * A Marathi/English pair. Both halves are required: a half-translated banner is a broken one. A
 * missing half reads the same as a blank one, so the admin screen shows one message for both.
 */
const half = (max: number, label: string) => {
  const required = `${label} is required`;
  return z
    .string({ required_error: required })
    .trim()
    .min(1, required)
    .max(max, `${label} must be at most ${max} characters`)
    .refine((v) => !hasControlChars(v), `${label} contains characters that cannot be displayed`);
};

/*
 * C0/C1 control characters other than tab and line breaks (a description is typed in a textarea).
 * PostgreSQL refuses NUL outright, which would otherwise surface as a 500 instead of a 422 naming the
 * field. A function rather than a regex literal, which no-control-regex forbids.
 */
const hasControlChars = (v: string) =>
  [...v].some((ch) => {
    const c = ch.codePointAt(0) ?? 0;
    return (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || (c >= 0x7f && c <= 0x9f);
  });
const bilingual = (max: number, label: string) =>
  z
    .object({
      mr: half(max, `${label} (Marathi)`),
      en: half(max, `${label} (English)`),
    })
    .strict();

/*
 * A page of this site — '/apply', '/programme?x=1#top' — and nothing else. The link lands in an
 * href on the home page, so a `javascript:` or `data:` URL, a full URL to another site, or a
 * protocol-relative '//host' would put a visitor somewhere the site never meant to send them.
 * Same pattern as the CHECK on home_hero_slides."ctaLink".
 */
export const HERO_LINK_PATTERN = /^\/[A-Za-z0-9._~/?=&%#-]*$/;
export const isSiteLink = (v: string) => HERO_LINK_PATTERN.test(v) && !v.startsWith('//');

const ctaLink = z
  .string({ required_error: 'Button link is required' })
  .trim()
  .min(1, 'Button link is required')
  .max(200, 'Button link must be at most 200 characters')
  /* A blank link already says "required"; one message per mistake. */
  .refine((v) => v === '' || isSiteLink(v), 'Button link must be a page on this site, starting with /');

const slide = z
  .object({
    tag: bilingual(60, 'Tag'),
    title: bilingual(200, 'Heading'),
    description: bilingual(400, 'Description'),
    ctaLabel: bilingual(60, 'Button label'),
    ctaLink,
    displayOrder: z.coerce.number().int().min(0).max(999).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const updateHeroSchema = {
  body: z
    .object({
      readMoreLabel: bilingual(60, 'Learn more button'),
      checkStatusLabel: bilingual(60, 'Check status button'),
      /*
       * A banner with nothing to rotate is an empty box at the top of the home page, so at least one
       * slide is required — and at least one of them must be visible, or it is empty all the same.
       */
      slides: z
        .array(slide)
        .min(1, 'At least one slide is required')
        .max(10, 'At most 10 slides')
        .refine((list) => list.length === 0 || list.some((s) => s.isActive !== false), 'At least one slide must be visible'),
      isPublished: z.boolean().optional(),
      /*
       * The district figure on the "Programme at a glance" card — the only one of its four that is
       * entered rather than summed from the modules. Optional: when omitted it is left as it is. The
       * messages are the admin screen's own, so a 422 reads the same as its client-side check.
       */
      districtCount: z.coerce
        .number({ invalid_type_error: 'District count must be a number' })
        .int('District count must be a whole number')
        .min(0, 'District count cannot be negative')
        .max(9999, 'District count is too large')
        .optional(),
      /* The updatedAt the admin screen loaded. When given, a save over a newer version is refused (409). */
      expectedUpdatedAt: z.string().datetime({ offset: true, message: 'expectedUpdatedAt must be an ISO-8601 date and time' }).optional(),
    })
    .strict(),
};

/* Publish / unpublish on its own, so visibility changes need not resubmit the whole section. */
export const heroStatusSchema = {
  body: z.object({ isPublished: z.boolean() }).strict(),
};

export type UpdateHeroBody = z.infer<typeof updateHeroSchema.body>;
export type HeroStatusBody = z.infer<typeof heroStatusSchema.body>;
