import type { ListQuery } from '../../utils/pagination';

/* Columns a client may sort by (?sortBy=). Anything else is rejected by the validator. */
export type StateSortField = 'name' | 'code' | 'createdAt' | 'updatedAt';

export type StateListQuery = ListQuery<StateSortField>;

/* API shape of a state. The entity itself is never serialised to a response. */
export interface PublicStateDetail {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  /* Only on the single-record response: districts currently attached to this state. */
  districtCount?: number;
}

export interface CreateStateInput {
  name: string;
  code: string;
  isActive?: boolean;
}

export interface UpdateStateInput {
  name?: string;
  code?: string;
}
