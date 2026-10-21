import type { ListQuery } from '../../shared/utils/pagination';

/* Columns a client may sort by (?sortBy=). Anything else is rejected by the validator. */
export type CentreTypeSortField = 'name' | 'code' | 'createdAt' | 'updatedAt';

export type CentreTypeListQuery = ListQuery<CentreTypeSortField>;

/* API shape of a training centre type. The entity itself is never serialised to a response. */
export interface PublicCentreTypeDetail {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  /* Only on the single-record response: non-deleted training centres of this type. */
  centreCount?: number;
}

export interface CreateCentreTypeInput {
  name: string;
  code: string;
  description?: string | null;
  isActive?: boolean;
}

export interface UpdateCentreTypeInput {
  name?: string;
  code?: string;
  description?: string | null;
}
