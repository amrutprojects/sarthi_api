import type { ListQuery } from '../../shared/utils/pagination';
import type { AssignmentReason, BatchStatus } from '../shared/master.constants';

/* Columns a client may sort by (?sortBy=). Student, batch and centre columns sort on the joined rows. */
export type BatchAssignmentSortField =
  | 'studentName' | 'studentCode' | 'batchName' | 'centreName' | 'assignedAt' | 'createdAt' | 'updatedAt';

export interface BatchAssignmentListQuery extends ListQuery<BatchAssignmentSortField> {
  /* Optional filters; batchId is also the deep link from the Batch view (?batchId=). */
  batchId?: string;
  centreId?: string;
  reasonCode?: AssignmentReason;
}

/*
 * API shape of an assignment. Batch, centre and student are resolved to names and codes so no client
 * displays a raw id. Only the student's code, name and preferred centre code are exposed: never Aadhaar or
 * any other personal field of the student register.
 */
export interface PublicBatchAssignmentDetail {
  id: string;
  batchId: string;
  batchName: string;
  batchCode: string;
  batchIsActive: boolean;
  batchStatus: BatchStatus;
  centreId: string;
  centreName: string;
  centreCode: string;
  studentId: string;
  studentCode: string;
  studentName: string;
  /* students.centreCode: the centre the student asked for (null when not recorded). */
  studentPreferredCentreCode: string | null;
  reasonCode: AssignmentReason | null;
  remarks: string | null;
  assignedAt: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/* One row of the student search feed of the Assign Batch form. */
export interface StudentOption {
  id: string;
  code: string;
  name: string;
  centreCode: string | null;
  /* Code of the batch the student already holds (non-deleted assignment), else null. */
  assignedBatchCode: string | null;
}

export interface CreateBatchAssignmentInput {
  batchId: string;
  studentId: string;
  reasonCode?: AssignmentReason | null;
  remarks?: string | null;
  isActive?: boolean;
}

/* studentId is deliberately absent: the student of an assignment never changes. */
export interface UpdateBatchAssignmentInput {
  batchId?: string;
  reasonCode?: AssignmentReason | null;
  remarks?: string | null;
}
