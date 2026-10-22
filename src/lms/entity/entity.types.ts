import type { ListQuery } from '../../shared/utils/pagination';

/* Columns a client may sort by (?sortBy=). */
export type LmsEntitySortField = 'name' | 'code' | 'createdAt' | 'updatedAt';

export interface LmsEntityListQuery extends ListQuery<LmsEntitySortField> {
  /* Entities that have this Admin Panel centre / track enabled (F-LMS-03-04 / -05 "Filter"). */
  centreId?: string;
  trackId?: string;
  /* true: ONLY soft-deleted entities (the "Show deleted" list); otherwise only the non-deleted ones. */
  deleted?: boolean;
}

/*
 * A centre enabled for the entity (contract E2). isActive is the centre's state in the Admin Panel right
 * now: a centre deactivated or deleted there after it was enabled stays in the selection and reads false.
 */
export interface EnabledCentre {
  id: string;
  name: string;
  code: string;
  districtName: string | null;
  isActive: boolean;
}

/* A technology track enabled for the entity (contract E2); isActive as for centres. */
export interface EnabledTrack {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

/* One kind of LMS record that points at the entity, with how many non-deleted rows do. */
export interface LmsEntityReference {
  label: string;
  count: number;
  /* True for the records that freeze the entity code (courses — the proxy for "first use in API-100"). */
  locksCode: boolean;
}

/* Only on the single-record response: why the entity cannot be deleted, or why its code is locked. */
export interface LmsEntityRelated {
  codeLocked: boolean;
  references: LmsEntityReference[];
}

/* API shape of an LMS entity (list rows and detail). */
export interface PublicLmsEntityDetail {
  id: string;
  name: string;
  code: string;
  description: string | null;
  defaultLanguage: string;
  timeZone: string;
  enabledCentres: EnabledCentre[];
  enabledTracks: EnabledTrack[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  related?: LmsEntityRelated;
}

/* GET /lms/entities/form-options: the values the form's dropdowns offer. */
export interface LmsEntityFormOptions {
  languages: { code: string; label: string }[];
  /* false while OQ-023 is open: the form marks the language list "To Be Confirmed". */
  languagesConfirmed: boolean;
  timeZones: string[];
  defaultTimeZone: string;
}

export interface CreateLmsEntityInput {
  name: string;
  code: string;
  description?: string | null;
  defaultLanguage: string;
  timeZone: string;
  centreIds: string[];
  trackIds: string[];
  isActive?: boolean;
}

/* undefined = not sent (left alone); null = cleared. centreIds / trackIds replace the whole selection. */
export interface UpdateLmsEntityInput {
  name?: string;
  code?: string;
  description?: string | null;
  defaultLanguage?: string;
  timeZone?: string;
  centreIds?: string[];
  trackIds?: string[];
}
