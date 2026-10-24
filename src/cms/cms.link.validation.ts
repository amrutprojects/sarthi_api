import { z } from 'zod';

/*
 * Where a CMS card may send a visitor (The AMRUT Ecosystem, AMRUT Schemes): a page of this site
 * ('/programme', '/apply?x=1#top') or a full http(s) address on another site. The link lands in an
 * href on the home page, so `javascript:`, `data:`, protocol-relative '//host' and addresses carrying
 * credentials are refused. Same rule as the CHECK on each table's "link" column.
 */
const SITE_PATH = /^\/[A-Za-z0-9._~/?=&%#-]*$/;

/* "www.example.gov.in" is how people type an address: it is stored as "https://www.example.gov.in". */
export const normalizeDestination = (v: string): string => (/^www\./i.test(v) ? `https://${v}` : v);

export function destinationProblem(raw: string): string | null {
  const v = normalizeDestination(raw);
  if (v.length > 500) return 'Destination must be at most 500 characters';
  if (v.startsWith('/')) {
    return SITE_PATH.test(v) && !v.startsWith('//')
      ? null
      : 'A page on this site must start with a single / and use only letters, digits and - _ . ~ / ? = & % #';
  }
  if (!/^https?:\/\//.test(v))
    return 'Destination must be a page on this site starting with /, or a web address starting with https:// or www.';
  if (/[\s<>"]/.test(v)) return 'The address contains characters that are not allowed';
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return 'The address is not a valid web address';
  }
  if (url.username || url.password) return 'The address must not contain a user name or password';
  if (!url.hostname.includes('.')) return 'Enter a full address, e.g. https://example.gov.in';
  return null;
}

/* null (or blank) is a card without a link. */
export const link = z
  .custom<string | null>((v) => v === null || typeof v === 'string', { message: 'Destination must be text or null' })
  .transform((v) => (v === null ? null : v.trim() ? normalizeDestination(v.trim()) : null))
  .superRefine((v, ctx) => {
    const problem = v === null ? null : destinationProblem(v);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });

/*
 * A destination that must be given (a Top Bar link without one is meaningless): the same rule and the
 * same "www." normalisation as `link`, but never null and never blank.
 */
export const requiredLink = z
  .string({ required_error: 'Destination is required', invalid_type_error: 'Destination must be text' })
  .transform((v) => normalizeDestination(v.trim()))
  .superRefine((v, ctx) => {
    const problem = v === '' ? 'Destination is required' : destinationProblem(v);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });
