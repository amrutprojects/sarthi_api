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
          opts.hyphen ? 'Use A–Z, 0–9 and hyphen, starting with a letter' : 'Use A–Z and 0–9 only, starting with a letter',
        ),
    );
