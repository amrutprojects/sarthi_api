import { z } from 'zod';

export const uuid = z.string().uuid('Must be a valid UUID');
export const idParams = z.object({ id: uuid });

/* Params of a nested route segment: parentIdParams('stateId') validates { stateId: <uuid> }. */
export const parentIdParams = (key: string) => z.object({ [key]: uuid }).strict();
export const statusBody = z.object({ isActive: z.boolean() }).strict();

/* Password policy: 10–128 chars with upper, lower and a digit. */
export const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a digit');

export const email = z.string().trim().toLowerCase().email('Must be a valid email address').max(255);
export const name = z.string().trim().min(1, 'Required').max(150);
export const description = z.string().trim().max(1000).nullable().optional();
export const idList = (field: string) => z.array(uuid).max(500, `Too many ${field}`);

/*
 * CMS master data names (State / District / Taluka).
 *
 * Any script is accepted — Marathi place names are written in Devanagari — plus the punctuation real
 * place names carry. The value is trimmed and runs of inner whitespace are collapsed before the
 * length and character checks, so "  Pune   City " and "Pune City" are stored identically and the
 * database's case-insensitive unique index sees one canonical form.
 */
export const masterName = z
  .string()
  .trim()
  .transform((s) => s.replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(2, 'Must be at least 2 characters')
      .max(100, 'Must be at most 100 characters')
      .regex(/^[\p{L}\p{M}][\p{L}\p{M}\d .,'’()/-]*$/u, 'Use letters, digits, spaces and . , ( ) - / only'),
  );

/*
 * Names of organisations and catalogue entries (departments, colleges, centres, batches, centre types).
 *
 * Same normalisation as masterName, but these names legitimately start with a digit ("21st Century
 * College") and contain "&" ("Computer Science & Engineering"), which place names never need.
 */
export const entityName = ({ min = 2, max = 100 }: { min?: number; max?: number } = {}) =>
  z
    .string()
    .trim()
    .transform((s) => s.replace(/\s+/g, ' '))
    .pipe(
      z
        .string()
        .min(min, `Must be at least ${min} characters`)
        .max(max, `Must be at most ${max} characters`)
        .regex(/^[\p{L}\p{M}\d][\p{L}\p{M}\d .,'’()/&-]*$/u, 'Use letters, digits, spaces and . , ( ) - / & only'),
    );

/*
 * Optional fields. Each returns undefined when the key is absent (an update leaves the column alone) and
 * null when it was sent empty (the value is cleared), so "not sent" and "cleared" never get confused.
 */
const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const optional = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(blankToNull, schema.nullable().optional());

/* Optional free text, trimmed. */
export const optionalText = (max: number) => optional(z.string().trim().max(max, `Must be at most ${max} characters`));

export const optionalUuid = optional(uuid);

export const optionalPinCode = optional(z.string().trim().regex(/^\d{6}$/, 'Enter a 6-digit PIN code'));

/* Indian mobile number: 10 digits starting 6–9. */
export const optionalMobile = optional(z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'));

/* Mobile, or a landline with its STD code (0XX-XXXXXXX); spaces are dropped before the check. */
export const optionalPhone = z.preprocess(
  (v) => (typeof v === 'string' ? v.replace(/\s+/g, '') : v),
  optional(z.string().regex(/^(?:[6-9]\d{9}|0\d{2,4}-?\d{6,8})$/, 'Enter a 10-digit mobile number or a landline with STD code')),
);

export const optionalEmail = optional(z.string().trim().toLowerCase().email('Enter a valid email address').max(254));

export const optionalHttpsUrl = (max = 500) =>
  optional(
    z
      .string()
      .trim()
      .max(max, `Must be at most ${max} characters`)
      .url('Enter a valid https link')
      .refine((v) => v.startsWith('https://'), 'Enter a valid https link'),
  );

/* Whole number in a range. Multipart and query values arrive as strings, so they are coerced. */
export const wholeNumber = (min: number, max: number) =>
  z.coerce
    .number({ invalid_type_error: 'Enter a whole number' })
    .int('Enter a whole number')
    .min(min, `Must be at least ${min}`)
    .max(max, `Must be at most ${max}`);

export const optionalWholeNumber = (min: number, max: number) => optional(wholeNumber(min, max));

/* Calendar date as YYYY-MM-DD (a real date, not just the shape). */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date as YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), 'Enter a valid date');

export const optionalIsoDate = optional(isoDate);

/*
 * CMS master data codes. Always stored upper case; `hyphen` allows codes such as MH-PUN.
 * The same shape is enforced by a CHECK constraint on each table.
 */
export const masterCode = (max: number, opts: { hyphen?: boolean } = {}) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .pipe(
      z
        .string()
        .min(2, 'Must be at least 2 characters')
        .max(max, `Must be at most ${max} characters`)
        .regex(
          opts.hyphen ? /^[A-Z][A-Z0-9-]*$/ : /^[A-Z][A-Z0-9]*$/,
          opts.hyphen
            ? 'Use A–Z, 0–9 and hyphen, starting with a letter'
            : 'Use A–Z and 0–9 only, starting with a letter',
        ),
    );
