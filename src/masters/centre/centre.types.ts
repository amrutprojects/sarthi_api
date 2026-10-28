import type { ListQuery } from '../../shared/utils/pagination';

/* Columns a client may sort by (?sortBy=). districtName sorts on the joined parent. */
export type CentreSortField = 'name' | 'code' | 'districtName' | 'createdAt' | 'updatedAt';

export interface CentreListQuery extends ListQuery<CentreSortField> {
  stateId?: string;
  districtId?: string;
  /* Centres offering this technology (track code, T01–T12). */
  technologyCode?: string;
}

/* An allocated Technology / 3rd module selection. usable = the track is active and not deleted (students may choose it). */
export interface CentreTechnologyRef {
  code: string;
  name: string;
  usable: boolean;
}

/* API shape of a centre: the College Master's shape plus the contact person and the allocated technologies. */
export interface PublicCentreDetail {
  id: string;
  name: string;
  code: string;
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
  talukaIsActive: boolean | null;
  address: string | null;
  pinCode: string | null;
  contactPerson: string | null;
  contactNumber: string | null;
  email: string | null;
  technologies: CentreTechnologyRef[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCentreInput {
  stateId?: string;
  districtId: string;
  talukaId?: string | null;
  name: string;
  code: string;
  address?: string | null;
  pinCode?: string | null;
  contactPerson?: string | null;
  contactNumber?: string | null;
  email?: string | null;
  /* Track codes (T01–T12); on update, when sent, replaces the allocation. */
  technologyCodes?: string[];
  isActive?: boolean;
}

export type UpdateCentreInput = Partial<Omit<CreateCentreInput, 'isActive'>>;

/* Who made a change: an Amrut admin panel user (from req.auth) or an EDP tracking panel admin. */
export interface CentreActor {
  edpAdminId?: string;
}
