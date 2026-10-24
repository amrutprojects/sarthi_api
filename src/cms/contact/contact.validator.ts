import { z } from 'zod';
import { idParams, statusBody } from '../../shared/validation/common.validation';
import { listQueryAscSchema } from '../../shared/utils/pagination';
import { ORG_TYPES } from './contact.model';

/*
 * Contact page request contract.
 *
 * Mirrors the database exactly: the same lengths, the same per-type required fields, the same URL
 * and email shapes. The CHECK constraints are the real guarantee; these rules exist so a mistake
 * comes back as a 422 naming the field rather than as a constraint violation.
 */

/* A Marathi/English pair. Both halves are required: a half-translated page is a broken page. */
const bilingual = (max: number, label: string) =>
  z
    .object({
      mr: z.string().trim().min(1, `${label} (Marathi) is required`).max(max, `${label} (Marathi) must be at most ${max} characters`),
      en: z.string().trim().min(1, `${label} (English) is required`).max(max, `${label} (English) must be at most ${max} characters`),
    })
    .strict();

/* Optional pair: omitted or null entirely, never one half. */
const optionalBilingual = (max: number, label: string) => bilingual(max, label).nullish();

const contactEmail = z.string().trim().toLowerCase().email('Must be a valid email address').max(255);

/*
 * Phone: digits, spaces, hyphens and brackets, with an optional leading +. Deliberately permissive
 * about formatting (the site shows "+91 97301 51450") and strict about content — no letters, and
 * between 6 and 20 digits so a truncated or pasted-wrong number is caught.
 */
const contactPhone = z
  .string()
  .trim()
  .max(32)
  .regex(/^\+?[0-9 ()-]+$/, 'Use digits, spaces, brackets and hyphens only, optionally starting with +')
  .refine((v) => {
    const digits = v.replace(/\D/g, '').length;
    return digits >= 6 && digits <= 20;
  }, 'Must contain between 6 and 20 digits');

/* Absolute http(s) only: a relative or javascript: URL must never reach an href on the public site. */
const websiteUrl = z
  .string()
  .trim()
  .max(255)
  .refine((v) => {
    try {
      return ['http:', 'https:'].includes(new URL(v).protocol);
    } catch {
      return false;
    }
  }, 'Must be an absolute http:// or https:// URL');

const organization = z
  .object({
    orgType: z.enum(ORG_TYPES),
    name: bilingual(150, 'Organisation name'),
    role: optionalBilingual(200, 'Role'),
    address: optionalBilingual(500, 'Address'),
    email: contactEmail.nullish(),
    phone: contactPhone.nullish(),
    websiteUrl: websiteUrl.nullish(),
    helpdeskHours: optionalBilingual(120, 'Helpdesk hours'),
    displayOrder: z.coerce.number().int().min(0).max(999).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  /*
   * Which fields a card must carry depends on what the card is — the same rule as
   * CHK_contact_organizations_required_by_type. Expressed as a superRefine so each missing field is
   * reported against its own path and lands on the right input in the admin form.
   */
  .superRefine((o, ctx) => {
    const require = (value: unknown, path: string, message: string) => {
      if (value === undefined || value === null || value === '') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
      }
    };
    if (o.orgType === 'AMRUT') {
      require(o.address, 'address', 'Address is required for the AMRUT card');
      require(o.email, 'email', 'Email is required for the AMRUT card');
      require(o.phone, 'phone', 'Phone is required for the AMRUT card');
    } else {
      require(o.role, 'role', 'Role is required for the implementation partner');
      require(o.email, 'email', 'Programme desk email is required for the implementation partner');
      require(o.helpdeskHours, 'helpdeskHours', 'Helpdesk hours are required for the implementation partner');
    }
  });

/*
 * A coordinator's phone may keep digits masked with X ("+91 98XXX 41201"), as the public site has
 * always shown them; an X counts as a digit for the length rule.
 */
const coordinatorPhone = z
  .string()
  .trim()
  .max(32)
  .regex(/^\+?[0-9Xx ()-]+$/, 'Use digits (or X for a masked digit), spaces, brackets and hyphens only, optionally starting with +')
  .refine((v) => {
    const digits = v.replace(/[^0-9Xx]/g, '').length;
    return digits >= 6 && digits <= 20;
  }, 'Must contain between 6 and 20 digits');

const coordinator = z
  .object({
    name: z.string().trim().min(1, 'Coordinator name is required').max(120, 'Coordinator name must be at most 120 characters'),
    phone: coordinatorPhone,
    email: contactEmail.nullish(),
    districtIds: z.array(z.string().uuid('Invalid district')).max(100).default([]),
    displayOrder: z.coerce.number().int().min(0).max(999).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

/* Every Collectorate field is optional: the website shows "to be supplied" for what is missing. */
const districtOffice = z
  .object({
    districtId: z.string().uuid('Invalid district'),
    collectorName: z.string().trim().max(150, 'Collector name must be at most 150 characters').nullish(),
    address: optionalBilingual(500, 'Office address'),
    phone: contactPhone.nullish(),
    email: contactEmail.nullish(),
    officeHours: optionalBilingual(120, 'Office hours'),
    isActive: z.boolean().optional(),
  })
  .strict();

export const updateContactPageSchema = {
  body: z
    .object({
      pageTitle: bilingual(150, 'Page title'),
      pageSubtitle: bilingual(300, 'Page subtitle'),
      isPublished: z.boolean().optional(),
      /* Both cards are expected; the cap leaves room for the extra cards the brief anticipates. */
      organizations: z.array(organization).min(1, 'At least one organisation is required').max(ORG_TYPES.length),
      coordinators: z.array(coordinator).max(100).optional(),
      districtOffices: z.array(districtOffice).max(500).optional(),
    })
    .strict(),
};

/* Publish / unpublish on its own, so visibility changes need not resubmit the whole page. */
export const contactStatusSchema = {
  body: z.object({ isPublished: z.boolean() }).strict(),
};

/*
 * The coordinator and district office sections, one entry at a time. Each entry takes exactly the
 * fields of a list entry of the PUT; an update carries any subset of them.
 */
const atLeastOneField = (b: object) => Object.keys(b).length > 0;

export const contactItemIdSchema = { params: idParams };
export const contactItemStatusSchema = { params: idParams, body: statusBody };

/* Display order first: the admin list reads in the order the website shows the cards. */
export const listCoordinatorsSchema = { query: listQueryAscSchema(['displayOrder', 'name', 'createdAt', 'updatedAt'] as const) };
export const createCoordinatorSchema = { body: coordinator };
/* districtIds, when sent, replaces the coordinator's districts in the order given. */
export const updateCoordinatorSchema = {
  params: idParams,
  body: coordinator.partial().refine(atLeastOneField, 'Provide at least one field to update'),
};

/* District name first: the order the website lists the offices in. */
export const listDistrictOfficesSchema = { query: listQueryAscSchema(['district', 'collectorName', 'createdAt', 'updatedAt'] as const) };
export const createDistrictOfficeSchema = { body: districtOffice };
export const updateDistrictOfficeSchema = {
  params: idParams,
  body: districtOffice.partial().refine(atLeastOneField, 'Provide at least one field to update'),
};

export type UpdateContactPageBody = z.infer<typeof updateContactPageSchema.body>;
export type ContactStatusBody = z.infer<typeof contactStatusSchema.body>;
export type ListCoordinatorsQuery = z.infer<typeof listCoordinatorsSchema.query>;
export type CreateCoordinatorBody = z.infer<typeof createCoordinatorSchema.body>;
export type UpdateCoordinatorBody = z.infer<typeof updateCoordinatorSchema.body>;
export type ListDistrictOfficesQuery = z.infer<typeof listDistrictOfficesSchema.query>;
export type CreateDistrictOfficeBody = z.infer<typeof createDistrictOfficeSchema.body>;
export type UpdateDistrictOfficeBody = z.infer<typeof updateDistrictOfficeSchema.body>;
