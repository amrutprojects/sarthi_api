import { z } from 'zod';
import { entityName, idParams, statusBody, uuid } from '../../shared/validation/common.validation';
import { listQueryAscSchema } from '../../shared/utils/pagination';
import { LMS_LANGUAGE_CODES } from '../entity/entity.constants';
import { COURSE_CODE_MAX, COURSE_STATUSES } from './course.constants';

/*
 * Rich text "sanitised; no scripts" (F-LMS-06-04, F-LMS-07-06; L-06 "Rich text is sanitised on the server;
 * external links must be https"). An ALLOW-LIST of the markup a basic rich-text editor produces, not a
 * pattern of known attacks:
 *   - <p> <br> <strong> <em> <b> <i> <u> <ul> <ol> <li>, without attributes;
 *   - <a href="https://…"> with optional target="_blank" and rel="…" (no entities in the link but &amp;).
 * Anything else a browser would read as markup — any other tag or attribute, a comment, an unquoted or
 * entity-encoded value, a non-https link — is refused rather than silently rewritten, so the stored text
 * is exactly what the author sent. A "<" that cannot open a tag ("a < b") is plain text, as in HTML.
 * The Module Master uses the same rule.
 */
const RICH_TEXT_TAGS = new Set(['p', 'br', 'strong', 'em', 'b', 'i', 'u', 'ul', 'ol', 'li', 'a']);
/* HTML whitespace (not \s: a no-break space does not separate attributes in a browser). */
const TAG = /<(\/?)([a-z]+)((?:[ \t\n\f\r]+[a-z]+="[^"<>]*")*)[ \t\n\f\r]*(\/?)>/y;
const ATTRIBUTE = /[ \t\n\f\r]+([a-z]+)="([^"<>]*)"/g;
/* RFC 3986 characters, after &amp; is read as "&" (no other entity is allowed, so none can hide a scheme). */
const HTTPS_URL = /^https:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/;
const RICH_TEXT_REFUSED = 'Use only paragraphs, bold, italic, lists and https links; remove other markup and scripts.';

/* "<" followed by a letter, "/", "!" or "?" starts markup in a browser (HTML tokenizer, tag open state). */
export const opensMarkup = (v: string): boolean => /<[a-zA-Z/!?]/.test(v);

function allowedTag(close: string, name: string, attrs: string, selfClose: string): boolean {
  if (!RICH_TEXT_TAGS.has(name)) return false;
  if (close) return !attrs && !selfClose && name !== 'br';
  if (name === 'br') return !attrs;
  if (selfClose) return false;
  if (name !== 'a') return !attrs;
  const seen = new Map<string, string>();
  for (const [, key, value] of attrs.matchAll(ATTRIBUTE)) {
    if (seen.has(key)) return false;
    seen.set(key, value);
  }
  const href = seen.get('href');
  return (
    href !== undefined &&
    !/&(?!amp;)/.test(href) &&
    HTTPS_URL.test(href.replace(/&amp;/g, '&')) &&
    [...seen.keys()].every((k) => k === 'href' || k === 'target' || k === 'rel') &&
    (!seen.has('target') || seen.get('target') === '_blank') &&
    (!seen.has('rel') || /^[a-z]+(?: [a-z]+)*$/.test(seen.get('rel')!))
  );
}

/* True when every piece of markup in the text is on the allow-list above. */
export function isAllowedRichText(text: string): boolean {
  for (let i = text.indexOf('<'); i !== -1; i = text.indexOf('<', i + 1)) {
    if (!opensMarkup(text.slice(i, i + 2))) continue;
    TAG.lastIndex = i;
    const m = TAG.exec(text);
    if (!m || !allowedTag(m[1], m[2], m[3], m[4])) return false;
    i = TAG.lastIndex - 1;
  }
  return true;
}

/* Like optionalText: absent → undefined (left alone), blank → null (cleared). */
export const richText = (max: number, tooLong: string) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().max(max, tooLong).refine(isAllowedRichText, RICH_TEXT_REFUSED).nullable().optional(),
  );

/* F-LMS-06-01: A–Z, 0–9 and hyphen (typed lower case is upper-cased, as every master code is). */
const courseCode = z
  .string({ required_error: 'Enter a course code.' })
  .trim()
  .toUpperCase()
  .pipe(
    z
      .string()
      .min(2, 'Must be at least 2 characters')
      .max(COURSE_CODE_MAX, `Must be at most ${COURSE_CODE_MAX} characters`)
      .regex(/^[A-Z0-9-]+$/, 'Use capital letters, digits and hyphens.'),
  );

/* F-LMS-06-02: 3–120 characters. */
const courseTitle = entityName({ min: 3, max: 120 });

/*
 * F-LMS-06-05: ≥ 1 language of the platform list (OQ-023, To Be Confirmed), each at most once. The
 * subset of the entity's enabled languages (F-LMS-04-07, Branding) needs the entity: course.service.ts.
 */
const languages = z
  .array(z.enum(LMS_LANGUAGE_CODES, { errorMap: () => ({ message: 'Select a language.' }) }))
  .min(1, 'Select at least one language.')
  .refine((l) => new Set(l).size === l.length, 'Each language can be selected only once');

export const listLmsCoursesSchema = {
  query: listQueryAscSchema(['code', 'title', 'status', 'createdAt', 'updatedAt'] as const).extend({
    status: z.enum(COURSE_STATUSES).optional(),
    entityId: uuid.optional(),
    /* 'true' lists ONLY the soft-deleted courses ("Show deleted", restored from the list); default 'false'. */
    deleted: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  }),
};

export const lmsCourseOptionsSchema = { query: z.object({ entityId: uuid.optional() }).strict() };

export const lmsCourseLanguagesSchema = { query: z.object({ entityId: uuid }).strict() };

export const lmsCourseIdSchema = { params: idParams };

/* Status (F-LMS-06-06) is system-set: never part of the body. */
export const createLmsCourseSchema = {
  body: z
    .object({
      entityId: uuid,
      code: courseCode,
      title: courseTitle,
      description: richText(2000, 'Shorten the description.'),
      languages: languages.optional(),
      isActive: z.boolean().optional(),
    })
    .strict(),
};

/* The entity is immutable after creation (F-LMS-06-03), so it is not accepted here. */
export const updateLmsCourseSchema = {
  params: idParams,
  body: z
    .object({
      code: courseCode.optional(),
      title: courseTitle.optional(),
      description: richText(2000, 'Shorten the description.'),
      languages: languages.optional(),
    })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
};

export const lmsCourseStatusSchema = { params: idParams, body: statusBody };

export type ListLmsCoursesQuery = z.infer<typeof listLmsCoursesSchema.query>;
export type LmsCourseOptionsQuery = z.infer<typeof lmsCourseOptionsSchema.query>;
export type LmsCourseLanguagesQuery = z.infer<typeof lmsCourseLanguagesSchema.query>;
export type CreateLmsCourseBody = z.infer<typeof createLmsCourseSchema.body>;
export type UpdateLmsCourseBody = z.infer<typeof updateLmsCourseSchema.body>;
