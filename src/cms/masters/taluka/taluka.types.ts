import type { ListQuery } from '../../../utils/pagination';

/* Columns a client may sort by (?sortBy=). districtName / stateName sort on the joined parents. */
export type TalukaSortField = 'name' | 'code' | 'districtName' | 'stateName' | 'createdAt' | 'updatedAt';

export interface TalukaListQuery extends ListQuery<TalukaSortField> {
  /* Both filters are optional and combine: stateId narrows through the district join. */
  stateId?: string;
  districtId?: string;
}

/*
 * API shape of a taluka. The district and — through it — the state are resolved to names, so the
 * listing and the detail page never show a raw foreign key.
 */
export interface PublicTalukaDetail {
  id: string;
  name: string;
  /* Optional: taluka code lists are often unavailable, so the column is nullable. */
  code: string | null;
  districtId: string;
  districtName: string;
  districtCode: string;
  districtIsActive: boolean;
  stateId: string;
  stateName: string;
  stateCode: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTalukaInput {
  districtId: string;
  name: string;
  code?: string | null;
  isActive?: boolean;
}

export interface UpdateTalukaInput {
  districtId?: string;
  name?: string;
  code?: string | null;
}
