import type { ListQuery } from '../../shared/utils/pagination';

/* Columns a client may sort by (?sortBy=). districtName sorts on the joined parent. */
export type CollegeSortField = 'name' | 'code' | 'districtName' | 'createdAt' | 'updatedAt';

export interface CollegeListQuery extends ListQuery<CollegeSortField> {
  /* Both filters are optional and combine: stateId narrows through the district join. */
  stateId?: string;
  districtId?: string;
}

/*
 * API shape of a college. The district, its state and the optional taluka are resolved to names and
 * codes, so the listing and the detail page never show a raw foreign key. The *IsActive flags let an
 * edit form warn about a parent that was deactivated after the college was saved.
 */
export interface PublicCollegeDetail {
  id: string;
  name: string;
  code: string;
  /* Derived from the district on the server; a college stores no state of its own. */
  stateId: string;
  stateName: string;
  stateCode: string;
  stateIsActive: boolean;
  districtId: string;
  districtName: string;
  districtCode: string;
  districtIsActive: boolean;
  talukaId: string | null;
  talukaName: string | null;
  talukaCode: string | null;
  /* null when the college has no taluka. */
  talukaIsActive: boolean | null;
  address: string | null;
  pinCode: string | null;
  contactNumber: string | null;
  email: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCollegeInput {
  /* Optional cross-check only (the first dropdown of the cascade); never stored. */
  stateId?: string;
  districtId: string;
  talukaId?: string | null;
  name: string;
  code: string;
  address?: string | null;
  pinCode?: string | null;
  contactNumber?: string | null;
  email?: string | null;
  isActive?: boolean;
}

export interface UpdateCollegeInput {
  stateId?: string;
  districtId?: string;
  talukaId?: string | null;
  name?: string;
  code?: string;
  address?: string | null;
  pinCode?: string | null;
  contactNumber?: string | null;
  email?: string | null;
}
