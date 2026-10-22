import type { ListQuery } from '../../shared/utils/pagination';

/* Columns a client may sort by (?sortBy=). Anything else is rejected by the validator. */
export type DepartmentSortField = 'name' | 'code' | 'createdAt' | 'updatedAt';

export type DepartmentListQuery = ListQuery<DepartmentSortField>;

/* API shape of a department. The entity itself is never serialised to a response. */
export interface PublicDepartmentDetail {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDepartmentInput {
  name: string;
  code: string;
  description?: string | null;
  isActive?: boolean;
}

export interface UpdateDepartmentInput {
  name?: string;
  code?: string;
  description?: string | null;
}
