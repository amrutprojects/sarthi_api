import { z } from 'zod';
import { FOOTER_LINK_KINDS, MAX_LINK_COLUMNS } from './footer.model';

/*
 * Footer request contract.
 *
 * Mirrors the database exactly: the same lengths, the same href rule per link kind, the same cap on
 * link columns. The CHECK constraints are the real guarantee; these rules exist so a mistake comes
 * back as a 422 naming the field rather than as a constraint violation.
 */

/* A Marathi/English pair. Both halves are required: a half-translated footer is a broken footer. */
const bilingual = (max: number, label: string) =>
  z
    .object({
      mr: z.string().trim().min(1, `${label} (Marathi) is required`).max(max, `${label} (Marathi) must be at most ${max} characters`),
      en: z.string().trim().min(1, `${label} (English) is required`).max(max, `${label} (English) must be at most ${max} characters`),
    })
    .strict();

const footerEmail = z.string().trim().toLowerCase().email('Must be a valid email address').max(255);

/* Same shape as the Contact page's rule: permissive about formatting, strict about content. */
const footerPhone = z
  .string()
  .trim()
  .max(32)
  .regex(/^\+?[0-9 ()-]+$/, 'Use digits, spaces, brackets and hyphens only, optionally starting with +')
  .refine((v) => {
    const digits = v.replace(/\D/g, '').length;
    return digits >= 6 && digits <= 20;
  }, 'Must contain between 6 and 20 digits');

/*
 * One footer line.
 *
 * The href rule is the whole point of this schema. A stored `javascript:` or `data:` URL would
 * reach an href attribute on every page of the public site, so the two linking kinds are checked
 * here and the two non-linking kinds are required to carry no href at all — otherwise an
 * administrator could park a URL on a TEXT row and have it go live by later switching the kind.
 */
const link = z
  .object({
    kind: z.enum(FOOTER_LINK_KINDS),
    label: bilingual(150, 'Link label'),
    href: z.string().trim().max(500).nullish(),
    displayOrder: z.coerce.number().int().min(0).max(999).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .superRefine((l, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['href'], message });

    if (l.kind === 'TEXT' || l.kind === 'UNAVAILABLE') {
      if (l.href) fail(`A ${l.kind} line has no destination, so it must not carry a link`);
      return;
    }

    if (!l.href) {
      fail(`A ${l.kind} link needs a destination`);
      return;
    }

    if (l.kind === 'INTERNAL') {
      /* An app path. `//host` is excluded because the browser reads it as protocol-relative. */
      if (!l.href.startsWith('/') || l.href.startsWith('//')) {
        fail('An internal link must be a path on this site, such as /apply');
      }
      return;
    }

    try {
      if (!['http:', 'https:'].includes(new URL(l.href).protocol)) {
        fail('Must be an absolute http:// or https:// URL');
      }
    } catch {
      fail('Must be an absolute http:// or https:// URL');
    }
  });

const linkColumn = z
  .object({
    heading: bilingual(200, 'Column heading'),
    displayOrder: z.coerce.number().int().min(0).max(999).optional(),
    isActive: z.boolean().optional(),
    links: z.array(link).max(20, 'A footer column holds at most 20 links'),
  })
  .strict();

export const updateFooterSchema = {
  body: z
    .object({
      about: z
        .object({
          heading: bilingual(200, 'About heading'),
          body: bilingual(2000, 'About text'),
          partnerLabel: bilingual(120, 'Partner label'),
          partnerName: bilingual(150, 'Partner name'),
        })
        .strict(),

      /*
       * The cap is the layout. `.gov-foot-in` is a four-column grid — About, two link columns,
       * Contact — so a third link column would wrap the footer onto a second row on every page.
       */
      linkColumns: z
        .array(linkColumn)
        .min(1, 'At least one link column is required')
        .max(MAX_LINK_COLUMNS, `The footer layout holds at most ${MAX_LINK_COLUMNS} link columns`),

      contact: z
        .object({
          heading: bilingual(200, 'Contact heading'),
          address: bilingual(500, 'Address'),
          email: footerEmail,
          phone: footerPhone,
          links: z.array(link).max(20, 'The contact column holds at most 20 extra lines').optional(),
        })
        .strict(),

      bottom: z
        .object({
          /* `{year}` is substituted by the website, so the stored text may contain the token. */
          copyright: bilingual(300, 'Copyright line'),
          disclaimer: bilingual(400, 'Disclaimer'),
        })
        .strict(),

      isPublished: z.boolean().optional(),
    })
    .strict(),
};

/* Publish / unpublish on its own, so visibility changes need not resubmit the whole footer. */
export const footerStatusSchema = {
  body: z.object({ isPublished: z.boolean() }).strict(),
};

export type UpdateFooterBody = z.infer<typeof updateFooterSchema.body>;
export type FooterStatusBody = z.infer<typeof footerStatusSchema.body>;
