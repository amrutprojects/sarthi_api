import { District } from '../../cms/masters/district/district.model';
import { TechnologyTrack } from '../../masters/technology-track/technology-track.model';
import { TrainingCentre } from '../../masters/training-centre/training-centre.model';
import type { Paginated } from '../../shared/utils/pagination';
import {
  referenceRepository, type ReferenceCentreRow, type ReferenceCountsRow, type ReferencePullRows,
} from './reference.repository';
import type {
  CentreRefOption, ReferenceCentre, ReferenceCentreListQuery, ReferenceDatasetSummary, ReferenceDistrict,
  ReferenceDistrictListQuery, ReferencePull, ReferencePullQuery, ReferencePullStatus, ReferenceSummary, ReferenceTrack,
  ReferenceTrackListQuery, TrackRefOption,
} from './reference.types';

/* Requires the state relation (every district read in ReferenceRepository joins it). */
const toDistrict = (d: District): ReferenceDistrict => ({
  id: d.id,
  code: d.code,
  name: d.name,
  stateId: d.stateId,
  stateName: d.state.name,
  stateCode: d.state.code,
  stateIsActive: d.state.isActive,
  isActive: d.isActive,
  sourceUpdatedAt: d.updatedAt,
});

const toCentre = (r: ReferenceCentreRow): ReferenceCentre => ({
  id: r.id,
  code: r.code,
  name: r.name,
  districtId: r.districtId,
  districtName: r.districtName,
  districtCode: r.districtCode,
  districtIsActive: r.districtIsActive,
  stateName: r.stateName,
  centreTypeName: r.centreTypeName,
  talukaName: r.talukaName,
  maxSeatingCapacity: r.maxSeatingCapacity,
  computerSystems: r.computerSystems,
  isActive: r.isActive,
  sourceUpdatedAt: r.sourceUpdatedAt,
});

const toTrack = (t: TechnologyTrack): ReferenceTrack => ({
  id: t.id,
  code: t.code,
  name: t.name,
  aliases: t.aliases,
  sortOrder: t.sortOrder,
  isActive: t.isActive,
  sourceUpdatedAt: t.updatedAt,
});

const toSummary = (c: ReferenceCountsRow, lastUpdatedAt = c.lastUpdatedAt): ReferenceDatasetSummary => ({
  total: c.total,
  active: c.active,
  inactive: c.total - c.active,
  sourceUpdatedAt: lastUpdatedAt,
});

const latest = (...dates: (Date | null)[]): Date | null =>
  dates.reduce<Date | null>((max, d) => (d && (!max || d > max) ? d : max), null);

/* API-122: a deleted row is sent as INACTIVE, the same as a deactivated one. */
const pullStatus = (r: { isActive: boolean; isDelete: boolean }): ReferencePullStatus =>
  r.isActive && !r.isDelete ? 'ACTIVE' : 'INACTIVE';

/* Maps one page of pullSnapshot rows to the API-122 wire shape (AMRUT_KALASH_03 §16.3.10). */
export const toReferencePull = (rows: ReferencePullRows, q: ReferencePullQuery): ReferencePull => ({
  districts: rows.districts.map((d) => ({
    district_id: d.id,
    district_code: d.code,
    name_en: d.name,
    name_mr: null,
    status: pullStatus(d),
    updated_at: d.updatedAt,
  })),
  centres: rows.centres.map((c) => ({
    centre_id: c.id,
    centre_code: c.code,
    district_code: c.districtCode,
    district_name: c.districtName,
    name: c.name,
    centre_type: c.centreTypeName,
    taluka: c.talukaName,
    readiness_status: null,
    max_seating_capacity: c.maxSeatingCapacity,
    computer_systems: c.computerSystems,
    tracks_offered: null,
    status: pullStatus(c),
    updated_at: c.sourceUpdatedAt,
  })),
  tracks: rows.tracks.map((t) => ({
    track_id: t.id,
    track_code: t.code,
    name: t.name,
    name_mr: null,
    sort_order: t.sortOrder,
    status: pullStatus(t),
    updated_at: t.updatedAt,
  })),
  as_of: rows.asOf,
  page: q.page,
  page_size: q.pageSize,
  has_more: rows.hasMore,
});

/*
 * Reference Data (UI-314; AMRUT_KALASH_03 L-03, L-07, BRL-309, DB-303) — read-only.
 *
 * Districts, training centres and technology tracks are mastered in the Admin Panel (AD-09). The spec describes
 * a reference-pull job (API-122 / INT-005) filling centre_ref / track_ref copies; here the LMS Admin shares the
 * Admin Panel's database, so it reads those tables directly and always shows the current values: there is no
 * copy that can go stale, no pull job, and nothing to "synchronise now". This service only reads; there is no
 * write path at all (BRL-309: "No administration route writes them").
 */
export class ReferenceService {
  async summary(): Promise<ReferenceSummary> {
    const [districts, centres, infrastructureUpdatedAt, tracks] = await Promise.all([
      referenceRepository.counts(District),
      referenceRepository.counts(TrainingCentre),
      referenceRepository.infrastructureLastUpdatedAt(),
      referenceRepository.counts(TechnologyTrack),
    ]);
    return {
      districts: toSummary(districts),
      /* Capacity and computer systems shown with each centre come from its capacity & infrastructure record. */
      centres: toSummary(centres, latest(centres.lastUpdatedAt, infrastructureUpdatedAt)),
      tracks: toSummary(tracks),
      sync: { mode: 'LIVE', source: 'Admin Panel (same database)' },
    };
  }

  async listDistricts(q: ReferenceDistrictListQuery): Promise<Paginated<ReferenceDistrict>> {
    const page = await referenceRepository.listDistricts(q);
    return { items: page.items.map(toDistrict), meta: page.meta };
  }

  async listCentres(q: ReferenceCentreListQuery): Promise<Paginated<ReferenceCentre>> {
    const page = await referenceRepository.listCentres(q);
    return { items: page.items.map(toCentre), meta: page.meta };
  }

  async listTracks(q: ReferenceTrackListQuery): Promise<Paginated<ReferenceTrack>> {
    const page = await referenceRepository.listTracks(q);
    return { items: page.items.map(toTrack), meta: page.meta };
  }

  /* R1: active, non-deleted training centres, A–Z, labelled with their district (F-LMS-03-04: ACTIVE rows only). */
  async centreOptions(entityId?: string): Promise<CentreRefOption[]> {
    const rows = await referenceRepository.selectableCentres(entityId);
    return rows.map((c) => ({ id: c.id, name: c.name, code: c.code, districtName: c.district.name }));
  }

  /* R1: active, non-deleted technology tracks in the Admin Panel's order (F-LMS-03-05: ACTIVE rows only). */
  async trackOptions(entityId?: string): Promise<TrackRefOption[]> {
    const rows = await referenceRepository.selectableTracks(entityId);
    return rows.map((t) => ({ id: t.id, name: t.name, code: t.code }));
  }

  /*
   * API-122 GET /integration/v1/reference: one page of the lists the LMS server (lms-api) copies into its own
   * read-only reference tables. Read-only like everything here; deleted rows are included as INACTIVE.
   */
  async pullSnapshot(q: ReferencePullQuery): Promise<ReferencePull> {
    return toReferencePull(await referenceRepository.pullSnapshot(q), q);
  }
}

export const referenceService = new ReferenceService();
