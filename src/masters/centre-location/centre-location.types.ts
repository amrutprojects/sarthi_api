import type { ListQuery } from '../../shared/utils/pagination';
import type { ParkingOption } from '../shared/master.constants';

/* Columns a client may sort by (?sortBy=). centreName / centreCode sort on the joined training centre. */
export type CentreLocationSortField = 'centreName' | 'centreCode' | 'createdAt' | 'updatedAt';

export interface CentreLocationListQuery extends ListQuery<CentreLocationSortField> {
  /* Optional filter, also used when the listing is opened from a training centre. */
  centreId?: string;
  parking?: ParkingOption;
}

/*
 * API shape of a centre's location information. The record has no name of its own: lists and titles
 * show the training centre's name and code, so both are always resolved here.
 */
export interface PublicCentreLocationDetail {
  id: string;
  centreId: string;
  centreName: string;
  centreCode: string;
  /* The record can still be edited when its centre is deactivated; the admin panel warns about it. */
  centreIsActive: boolean;
  address: string;
  pinCode: string | null;
  locationUrl: string | null;
  nearestLandmark: string | null;
  nearestStation: string | null;
  publicTransport: string | null;
  parking: ParkingOption | null;
  remarks: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCentreLocationInput {
  centreId: string;
  address: string;
  pinCode?: string | null;
  locationUrl?: string | null;
  nearestLandmark?: string | null;
  nearestStation?: string | null;
  publicTransport?: string | null;
  parking?: ParkingOption | null;
  remarks?: string | null;
  isActive?: boolean;
}

/* The centre is fixed once the record exists: to move it, delete this record and add one for the other centre. */
export interface UpdateCentreLocationInput {
  address?: string;
  pinCode?: string | null;
  locationUrl?: string | null;
  nearestLandmark?: string | null;
  nearestStation?: string | null;
  publicTransport?: string | null;
  parking?: ParkingOption | null;
  remarks?: string | null;
}
