import type { ListQuery } from '../../shared/utils/pagination';

/* Columns a client may sort by (?sortBy=). stateName sorts on the joined parent. */
export type DistrictSortField = 'name' | 'code' | 'stateName' | 'createdAt' | 'updatedAt';

export interface DistrictListQuery extends ListQuery<DistrictSortField> {
  /* Optional filter, also used by the District listing when it is opened from a state. */
  stateId?: string;
}

/*
 * API shape of a district. The state is always resolved to its name and code so no client ever has to
 * display a raw foreign key, and the listing shows the real state name rather than an id.
 */
export interface PublicDistrictDetail {
  id: string;
  name: string;
  code: string;
  stateId: string;
  stateName: string;
  stateCode: string;
  /* A district under a deactivated state must be re-pointed before it can be saved again. */
  stateIsActive: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  /* Only on the single-record response: talukas currently attached to this district. */
  talukaCount?: number;
}

export interface CreateDistrictInput {
  stateId: string;
  name: string;
  code: string;
  isActive?: boolean;
}

export interface UpdateDistrictInput {
  stateId?: string;
  name?: string;
  code?: string;
}
