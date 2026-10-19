import type { OrgType } from './contact.model';

/* A Marathi/English pair, matching the website's Bilingual type (public-site/content/types.ts). */
export interface Bilingual {
  mr: string;
  en: string;
}

/* ---------------- admin shapes ---------------- */

/*
 * One card, as the admin panel sees it. Fields that do not apply to the card's type are null rather
 * than absent, so the form can bind to a stable shape.
 */
export interface AdminOrganization {
  id: string;
  orgType: OrgType;
  name: Bilingual;
  role: Bilingual | null;
  address: Bilingual | null;
  email: string | null;
  phone: string | null;
  websiteUrl: string | null;
  helpdeskHours: Bilingual | null;
  displayOrder: number;
  isActive: boolean;
}

export interface AdminContactPage {
  id: string;
  pageTitle: Bilingual;
  pageSubtitle: Bilingual;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
  organizations: AdminOrganization[];
}

/* ---------------- public shapes ---------------- */

/*
 * What the website receives. Deliberately narrower than the admin shape: no ids, no timestamps, no
 * publication flag, no soft-delete state — a visitor needs the words on the page and nothing else.
 * Null fields are omitted entirely so the consumer can test for presence.
 */
export interface PublicOrganization {
  orgType: OrgType;
  name: Bilingual;
  role?: Bilingual;
  address?: Bilingual;
  email?: string;
  phone?: string;
  websiteUrl?: string;
  helpdeskHours?: Bilingual;
}

export interface PublicContactPage {
  pageTitle: Bilingual;
  pageSubtitle: Bilingual;
  organizations: PublicOrganization[];
}

/* ---------------- write shapes ---------------- */

export interface UpdateOrganizationInput {
  orgType: OrgType;
  name: Bilingual;
  role?: Bilingual | null;
  address?: Bilingual | null;
  email?: string | null;
  phone?: string | null;
  websiteUrl?: string | null;
  helpdeskHours?: Bilingual | null;
  displayOrder?: number;
  isActive?: boolean;
}

export interface UpdateContactPageInput {
  pageTitle: Bilingual;
  pageSubtitle: Bilingual;
  isPublished?: boolean;
  organizations: UpdateOrganizationInput[];
}
