import type { ListQuery } from '../../shared/utils/pagination';
import type { FacilityMap } from '../shared/master.constants';

/* Columns a client may sort by (?sortBy=). centreName / centreCode sort on the joined training centre. */
export type CentreInfrastructureSortField = 'centreName' | 'centreCode' | 'maxSeatingCapacity' | 'createdAt' | 'updatedAt';

export interface CentreInfrastructureListQuery extends ListQuery<CentreInfrastructureSortField> {
  /* Optional filter, also used when the listing is opened from a training centre. */
  centreId?: string;
}

/*
 * API shape of a centre's capacity and infrastructure. The record has no name of its own: lists and
 * titles show the training centre's name and code, so both are always resolved here.
 */
export interface PublicCentreInfrastructureDetail {
  id: string;
  centreId: string;
  centreName: string;
  centreCode: string;
  /* The record can still be edited when its centre is deactivated; the admin panel warns about it. */
  centreIsActive: boolean;
  maxSeatingCapacity: number;
  numberOfFloors: number | null;
  trainingRooms: number | null;
  computerSystems: number | null;
  internetType: string | null;
  internetSpeed: string | null;
  /* Amenity flags: true / false, or null when not recorded. */
  hasLift: boolean | null;
  hasAc: boolean | null;
  hasWashroom: boolean | null;
  hasDrinkingWater: boolean | null;
  powerBackup: string | null;
  /* Only the facilities that have been assessed; a missing code means "not recorded". */
  facilities: FacilityMap;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/* KPI figures of the listing, optionally scoped to one centre. */
export interface CentreInfrastructureSummary {
  total: number;
  active: number;
  inactive: number;
  /* Sum of maxSeatingCapacity over the active records. */
  activeSeatingCapacity: number;
}

interface EditableFields {
  numberOfFloors?: number | null;
  trainingRooms?: number | null;
  computerSystems?: number | null;
  internetType?: string | null;
  internetSpeed?: string | null;
  hasLift?: boolean | null;
  hasAc?: boolean | null;
  hasWashroom?: boolean | null;
  hasDrinkingWater?: boolean | null;
  powerBackup?: string | null;
  /* When sent, replaces the whole map. */
  facilities?: FacilityMap;
}

export interface CreateCentreInfrastructureInput extends EditableFields {
  centreId: string;
  maxSeatingCapacity: number;
  isActive?: boolean;
}

/* The centre is fixed once the record exists: to move it, delete this record and add one for the other centre. */
export interface UpdateCentreInfrastructureInput extends EditableFields {
  maxSeatingCapacity?: number;
}
