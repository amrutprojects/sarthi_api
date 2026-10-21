import type { ListQuery } from '../../shared/utils/pagination';
import type { GeoOption } from '../../masters/geography/geography.types';

/*
 * Reference Data (UI-314, AMRUT_KALASH_03 L-03 / L-07 / DB-303): the Admin Panel's districts, training centres
 * and technology tracks, read by the LMS Admin. The LMS Admin and the Admin Panel share one database, so these
 * shapes are read straight from the Admin Panel tables; nothing here is copied, stored or written by the LMS.
 *
 * `sourceUpdatedAt` is the spec's "source update time" (centre_ref / track_ref source_updated_at): the time the
 * Admin Panel last changed the record.
 */

/* Columns a client may sort by (?sortBy=). Parent names sort on the joined Admin Panel rows. */
export type ReferenceDistrictSortField = 'name' | 'code' | 'stateName' | 'updatedAt';
export type ReferenceCentreSortField = 'name' | 'code' | 'districtName' | 'centreTypeName' | 'talukaName' | 'updatedAt';
export type ReferenceTrackSortField = 'sortOrder' | 'code' | 'name' | 'updatedAt';

export type ReferenceDistrictListQuery = ListQuery<ReferenceDistrictSortField>;
export type ReferenceCentreListQuery = ListQuery<ReferenceCentreSortField>;
export type ReferenceTrackListQuery = ListQuery<ReferenceTrackSortField>;

/* A district of the Admin Panel geography master (State → District). */
export interface ReferenceDistrict {
  id: string;
  code: string;
  name: string;
  stateId: string;
  stateName: string;
  stateCode: string;
  stateIsActive: boolean;
  isActive: boolean;
  sourceUpdatedAt: Date;
}

/*
 * A training centre of the Admin Panel's Training Centre Profile, with the fields of the profile the LMS needs
 * that the Admin Panel records today (L-03): code, name, district, centre type, taluka, maximum seating capacity
 * and computer systems (the last two from the centre's capacity & infrastructure record, null when none exists),
 * and status. Readiness status and tracks offered are not recorded by the Admin Panel, so they are not returned.
 */
export interface ReferenceCentre {
  id: string;
  code: string;
  name: string;
  districtId: string;
  districtName: string;
  districtCode: string;
  districtIsActive: boolean;
  stateName: string;
  centreTypeName: string | null;
  talukaName: string | null;
  maxSeatingCapacity: number | null;
  computerSystems: number | null;
  isActive: boolean;
  /* The later of the centre's own update and its capacity & infrastructure record's update. */
  sourceUpdatedAt: Date;
}

/* One of the technology tracks (T01–T12) of the Admin Panel's technology_tracks list. */
export interface ReferenceTrack {
  id: string;
  code: string;
  name: string;
  aliases: string[];
  sortOrder: number;
  isActive: boolean;
  sourceUpdatedAt: Date;
}

/* Counts of one dataset over its non-deleted rows, and the time the Admin Panel last changed it. */
export interface ReferenceDatasetSummary {
  total: number;
  active: number;
  inactive: number;
  /* null while the source table holds no row at all. */
  sourceUpdatedAt: Date | null;
}

export interface ReferenceSummary {
  districts: ReferenceDatasetSummary;
  centres: ReferenceDatasetSummary;
  tracks: ReferenceDatasetSummary;
  /*
   * How the LMS receives the data. LIVE: same database as the Admin Panel, read on every request, so there is
   * no reference-pull job (API-122) and nothing to "synchronise now".
   */
  sync: { mode: 'LIVE'; source: 'Admin Panel (same database)' };
}

/* R1 dropdown feed item for a centre picker: labelled with its district so same-named centres can be told apart. */
export interface CentreRefOption extends GeoOption {
  code: string;
  districtName: string;
}

/* R1 dropdown feed item for a track picker. */
export interface TrackRefOption extends GeoOption {
  code: string;
}
