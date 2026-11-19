import type { ListQuery } from '../../shared/utils/pagination';
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
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminDistrictOffice {
  id: string;
  district: DistrictRef;
  /* The District Coordinator's name, in both languages; null while it is not supplied. */
  collectorName: Bilingual | null;
  address: Bilingual | null;
  phone: string | null;
  email: string | null;
  officeHours: Bilingual | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/* Columns a client may sort the two section lists by (?sortBy=). Anything else is rejected by the validator. */
export type CoordinatorSortField = 'displayOrder' | 'name' | 'createdAt' | 'updatedAt';
export type CoordinatorListQuery = ListQuery<CoordinatorSortField>;

/* `district` sorts by the district's name, the order the website lists the offices in; `collectorName` by the English name. */
export type DistrictOfficeSortField = 'district' | 'collectorName' | 'createdAt' | 'updatedAt';
export type DistrictOfficeListQuery = ListQuery<DistrictOfficeSortField>;

export interface AdminTrainingCentre {
  id: string;
  district: DistrictRef;
  name: Bilingual;
  address: Bilingual | null;
  managerName: Bilingual | null;
  phone: string | null;
  email: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/* `district` sorts by the district's name, then the centres' own order — the order each district page lists them in. */
export type TrainingCentreSortField = 'district' | 'name' | 'displayOrder' | 'createdAt' | 'updatedAt';
/* `districtId` narrows the list to one district's centres. */
export type TrainingCentreListQuery = ListQuery<TrainingCentreSortField> & { districtId?: string };

export interface AdminContactPage {
  id: string;
  pageTitle: Bilingual;
  pageSubtitle: Bilingual;
  isPublished: boolean;
  /* The "District offices" section's switch; read-only here — PATCH /district-offices-section is its one writer. */
  showDistrictOffices: boolean;
  /* The District Office pages' "Approved training centres" card; PATCH /training-centres-section is its one writer. */
  showTrainingCentres: boolean;
  /* The WhatsApp button's number, digits only; '' when the website uses the AMRUT card's phone. */
  whatsappNumber: string;
  /* Its pre-filled message; both halves '' when the website uses its default message. */
  whatsappMessage: Bilingual;
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
  collectorName?: Bilingual;
  address?: Bilingual;
  phone?: string;
  email?: string;
  officeHours?: Bilingual;
}

/* One active training centre; the website lists a district's centres in the order they arrive. */
export interface PublicTrainingCentre {
  district: PublicDistrictRef;
  name: Bilingual;
  address?: Bilingual;
  managerName?: Bilingual;
  phone?: string;
  email?: string;
}

/*
 * The WhatsApp button. Unlike the other public fields, blanks are sent as null rather than omitted:
 * number null → the website dials the AMRUT card's phone; message null → its default message.
 */
export interface PublicWhatsApp {
  number: string | null;
  message: Bilingual | null;
}

export interface PublicContactPage {
  pageTitle: Bilingual;
  pageSubtitle: Bilingual;
  organizations: PublicOrganization[];
  coordinators: PublicCoordinator[];
  districtOffices: PublicDistrictOffice[];
  whatsapp: PublicWhatsApp;
  /* false: the website leaves out the Contact page's "District offices" section (heading and list). */
  showDistrictOffices: boolean;
  /* Every active centre, by district name and then each district's own order. */
  trainingCentres: PublicTrainingCentre[];
  /* false: the District Office pages leave out the "Approved training centres" card. */
  showTrainingCentres: boolean;
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
  collectorName?: Bilingual | null;
  address?: Bilingual | null;
  phone?: string | null;
  email?: string | null;
  officeHours?: Bilingual | null;
  isActive?: boolean;
}

/*
 * The one-item endpoints (/coordinators, /district-offices) take the fields of one list entry of the
 * PUT. An update carries any subset of them; an absent field leaves its column as it is.
 */
export type CreateCoordinatorInput = UpdateCoordinatorInput;
export type PatchCoordinatorInput = Partial<UpdateCoordinatorInput>;
/* Sent with a one-card create / update once the administrator confirmed taking districts from their current coordinator. */
export interface MoveDistrictsOption {
  moveDistricts?: boolean;
}
export type CreateDistrictOfficeInput = UpdateDistrictOfficeInput;
export type PatchDistrictOfficeInput = Partial<UpdateDistrictOfficeInput>;

/*
 * coordinators / districtOffices are optional: a payload that omits a list leaves that section
 * exactly as it is, so a client that only edits the banner and cards cannot wipe them by accident.
 */
export interface UpdateContactPageInput {
  pageTitle: Bilingual;
  pageSubtitle: Bilingual;
  isPublished?: boolean;
  /* Optional like the sections below: absent leaves the stored value as it is. '' / null resets to the default. */
  whatsappNumber?: string;
  whatsappMessage?: Bilingual | null;
  organizations: UpdateOrganizationInput[];
  coordinators?: UpdateCoordinatorInput[];
  districtOffices?: UpdateDistrictOfficeInput[];
}

/* A training centre, one at a time (/training-centres). An update carries any subset; null clears an optional field. */
export interface CreateTrainingCentreInput {
  districtId: string;
  name: Bilingual;
  address?: Bilingual | null;
  managerName?: Bilingual | null;
  phone?: string | null;
  email?: string | null;
  displayOrder?: number;
  isActive?: boolean;
}
export type PatchTrainingCentreInput = Partial<CreateTrainingCentreInput>;
