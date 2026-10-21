import type { ListQuery } from '../../shared/utils/pagination';
import type { GeoOption } from '../../cms/masters/geography/geography.types';
import type { BatchStatus, DeliveryMode } from '../shared/master.constants';

/* Columns a client may sort by (?sortBy=). centreName sorts on the joined training centre. */
export type BatchSortField = 'name' | 'code' | 'centreName' | 'startDate' | 'capacity' | 'batchStatus' | 'createdAt' | 'updatedAt';

export interface BatchListQuery extends ListQuery<BatchSortField> {
  /* Optional filter, also used by the Batch listing when it is opened from a training centre. */
  centreId?: string;
  batchStatus?: BatchStatus;
  deliveryMode?: DeliveryMode;
}

/*
 * API shape of a batch. The centre is always resolved to its name and code so no client has to display a
 * raw foreign key. assignedCount / seatsLeft are computed from the active, non-deleted assignments;
 * assignmentCount counts inactive ones too.
 */
export interface PublicBatchDetail {
  id: string;
  centreId: string;
  centreName: string;
  centreCode: string;
  /* A batch under a deactivated centre keeps it, but no new batch can be attached to that centre. */
  centreIsActive: boolean;
  name: string;
  code: string;
  trackName: string | null;
  capacity: number;
  /* 'YYYY-MM-DD' */
  startDate: string;
  endDate: string | null;
  deliveryMode: DeliveryMode;
  batchStatus: BatchStatus;
  /* Students holding a seat: active, non-deleted assignments. Drives the capacity floor and the cancel rule. */
  assignedCount: number;
  /*
   * Every non-deleted assignment, active or inactive. While it is above 0 the centre and code are fixed
   * and the batch cannot be deleted, so clients base those locks on this count, not on assignedCount.
   */
  assignmentCount: number;
  seatsLeft: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/* Both assignment counts of one batch (see PublicBatchDetail). */
export type BatchAssignmentCounts = Pick<PublicBatchDetail, 'assignedCount' | 'assignmentCount'>;

/*
 * One row of GET /cms/batches/options. centreCode is the code of the batch's training centre, so the
 * Assign Batch form can tell before saving whether the student's preferred centre differs (reason required).
 */
export interface BatchOption extends GeoOption {
  code: string;
  centreCode: string;
}

export interface CreateBatchInput {
  centreId: string;
  name: string;
  /* null / absent = generate AMK-B-{centreCode}-{NNN}. */
  code?: string | null;
  trackName?: string | null;
  capacity: number;
  startDate: string;
  endDate?: string | null;
  deliveryMode: DeliveryMode;
  batchStatus?: BatchStatus;
  isActive?: boolean;
}

export interface UpdateBatchInput {
  centreId?: string;
  name?: string;
  /* undefined = keep, null = (re)generate for the batch's centre, string = set. */
  code?: string | null;
  trackName?: string | null;
  capacity?: number;
  startDate?: string;
  endDate?: string | null;
  deliveryMode?: DeliveryMode;
  batchStatus?: BatchStatus;
}
