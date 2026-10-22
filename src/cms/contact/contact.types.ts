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

/* A district as the Contact sections reference it. */
export interface DistrictRef {
  id: string;
  name: string;
  code: string;
}

export interface AdminCoordinator {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  districts: DistrictRef[];
  displayOrder: number;
  isActive: boolean;
}

export interface AdminDistrictOffice {
  id: string;
  district: DistrictRef;
  collectorName: string | null;
  address: Bilingual | null;
  phone: string | null;
  email: string | null;
  officeHours: Bilingual | null;
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
  coordinators: AdminCoordinator[];
  districtOffices: AdminDistrictOffice[];
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

/* Districts are identified to the website by code and name; it matches them to its own district list. */
export interface PublicDistrictRef {
  code: string;
  name: string;
}

export interface PublicCoordinator {
  name: string;
  phone: string;
  email?: string;
  districts: PublicDistrictRef[];
}

export interface PublicDistrictOffice {
  district: PublicDistrictRef;
  collectorName?: string;
  address?: Bilingual;
  phone?: string;
  email?: string;
  officeHours?: Bilingual;
}

export interface PublicContactPage {
  pageTitle: Bilingual;
  pageSubtitle: Bilingual;
  organizations: PublicOrganization[];
  coordinators: PublicCoordinator[];
  districtOffices: PublicDistrictOffice[];
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

export interface UpdateCoordinatorInput {
  name: string;
  phone: string;
  email?: string | null;
  districtIds: string[];
  displayOrder?: number;
  isActive?: boolean;
}

export interface UpdateDistrictOfficeInput {
  districtId: string;
  collectorName?: string | null;
  address?: Bilingual | null;
  phone?: string | null;
  email?: string | null;
  officeHours?: Bilingual | null;
  isActive?: boolean;
}

/*
 * coordinators / districtOffices are optional: a payload that omits a list leaves that section
 * exactly as it is, so a client that only edits the banner and cards cannot wipe them by accident.
 */
export interface UpdateContactPageInput {
  pageTitle: Bilingual;
  pageSubtitle: Bilingual;
  isPublished?: boolean;
  organizations: UpdateOrganizationInput[];
  coordinators?: UpdateCoordinatorInput[];
  districtOffices?: UpdateDistrictOfficeInput[];
}
