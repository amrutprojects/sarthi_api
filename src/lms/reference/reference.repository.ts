import type { EntityManager, EntityTarget, ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { Brackets } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { CentreInfrastructure } from '../../masters/centre-infrastructure/centre-infrastructure.model';
import { District } from '../../cms/masters/district/district.model';
import { TechnologyTrack } from '../../masters/technology-track/technology-track.model';
import { TrainingCentre } from '../../masters/training-centre/training-centre.model';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../shared/utils/pagination';
import type {
  ReferenceCentreListQuery, ReferenceCentreSortField, ReferenceDistrictListQuery, ReferenceDistrictSortField,
  ReferenceTrackListQuery, ReferenceTrackSortField,
} from './reference.types';

/* sortBy → SQL, so joined parent names are sortable without exposing a column name to clients. */
const DISTRICT_SORT_SQL: Record<ReferenceDistrictSortField, string> = {
  name: 'd.name',
  code: 'd.code',
  stateName: 's.name',
  updatedAt: 'd.updatedAt',
};

/* Centres are read as raw rows (see listCentres), so these are plain quoted SQL expressions. */
const CENTRE_SOURCE_UPDATED_AT = `GREATEST("tc"."updatedAt", "ci"."updatedAt")`;
const CENTRE_SORT_SQL: Record<ReferenceCentreSortField, string> = {
  name: '"tc"."name"',
  code: '"tc"."code"',
  districtName: '"d"."name"',
  centreTypeName: '"ct"."name"',
  talukaName: '"tk"."name"',
  updatedAt: CENTRE_SOURCE_UPDATED_AT,
};

const TRACK_SORT_SQL: Record<ReferenceTrackSortField, string> = {
  sortOrder: 't.sortOrder',
  code: 't.code',
  name: 't.name',
  updatedAt: 't.updatedAt',
};

/* One centre as listCentres selects it. pg returns int4 as number and timestamptz as Date. */
export interface ReferenceCentreRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  districtId: string;
  districtName: string;
  districtCode: string;
  districtIsActive: boolean;
  stateName: string;
  centreTypeName: string | null;
  talukaName: string | null;
  maxSeatingCapacity: number | null;
  computerSystems: number | null;
  sourceUpdatedAt: Date;
}

/* Raw counts of one source table: non-deleted rows, the active ones, and the latest change of any row. */
export interface ReferenceCountsRow {
  total: number;
  active: number;
  lastUpdatedAt: Date | null;
}

/*
 * Read-only access to the Admin Panel's reference tables (districts, training_centres, technology_tracks).
 *
 * Deliberately NOT a BaseRepository: that class carries create / update / softDelete / restore, and nothing in
 * the LMS may write these tables (BRL-309 "no administration route writes them"; the Admin Panel owns them).
 * Only SELECTs exist here. Every read applies the shared soft-delete rule (isDelete = false) itself.
 */
export class ReferenceRepository {
  private repo<T extends ObjectLiteral>(target: EntityTarget<T>, manager?: EntityManager): Repository<T> {
    return (manager ?? AppDataSource.manager).getRepository(target);
  }

  /* ---- districts ---- */

  private districts(manager?: EntityManager): SelectQueryBuilder<District> {
    return this.repo(District, manager).createQueryBuilder('d').innerJoinAndSelect('d.state', 's').where('d.isDelete = false');
  }

  async listDistricts(q: ReferenceDistrictListQuery): Promise<Paginated<District>> {
    const qb = this.districts();
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(new Brackets((w) => w
        .where('d.name ILIKE :term', { term })
        .orWhere('d.code ILIKE :term', { term })
        .orWhere('s.name ILIKE :term', { term })));
    }
    if (q.isActive !== undefined) qb.andWhere('d.isActive = :isActive', { isActive: q.isActive });
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.orderBy(DISTRICT_SORT_SQL[q.sortBy], q.sortOrder).addOrderBy('d.id').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /* ---- training centres ---- */

  /*
   * Centres with their Admin Panel parents: district (and its state) are compulsory, centre type and taluka
   * optional, and the capacity & infrastructure record (at most one non-deleted row per centre, by the
   * UQ_centre_infrastructure_centre_active index) supplies seating capacity and computer systems. Every join is
   * to-one, so one row per centre and plain OFFSET / LIMIT paging are exact.
   */
  private centres(manager?: EntityManager): SelectQueryBuilder<TrainingCentre> {
    return this.repo(TrainingCentre, manager)
      .createQueryBuilder('tc')
      .innerJoin('tc.district', 'd')
      .innerJoin('d.state', 's')
      .leftJoin('tc.centreType', 'ct')
      .leftJoin('tc.taluka', 'tk')
      .leftJoin(CentreInfrastructure, 'ci', '"ci"."centreId" = "tc"."id" AND "ci"."isDelete" = false')
      .where('tc.isDelete = false');
  }

  async listCentres(q: ReferenceCentreListQuery): Promise<Paginated<ReferenceCentreRow>> {
    const qb = this.centres();
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(new Brackets((w) => w
        .where('tc.name ILIKE :term', { term })
        .orWhere('tc.code ILIKE :term', { term })
        .orWhere('d.name ILIKE :term', { term })
        .orWhere('tk.name ILIKE :term', { term })
        .orWhere('ct.name ILIKE :term', { term })));
    }
    if (q.isActive !== undefined) qb.andWhere('tc.isActive = :isActive', { isActive: q.isActive });

    const total = await qb.getCount();
    const { skip, take } = toSkipTake(q);
    const items = await qb
      .select('tc.id', 'id')
      .addSelect('tc.code', 'code')
      .addSelect('tc.name', 'name')
      .addSelect('tc.isActive', 'isActive')
      .addSelect('d.id', 'districtId')
      .addSelect('d.name', 'districtName')
      .addSelect('d.code', 'districtCode')
      .addSelect('d.isActive', 'districtIsActive')
      .addSelect('s.name', 'stateName')
      .addSelect('ct.name', 'centreTypeName')
      .addSelect('tk.name', 'talukaName')
      .addSelect('"ci"."maxSeatingCapacity"', 'maxSeatingCapacity')
      .addSelect('"ci"."computerSystems"', 'computerSystems')
      .addSelect(CENTRE_SOURCE_UPDATED_AT, 'sourceUpdatedAt')
      /* NULLS LAST keeps centres without a type / taluka at the end in both directions. */
      .orderBy(CENTRE_SORT_SQL[q.sortBy], q.sortOrder, 'NULLS LAST')
      .addOrderBy('tc.id', 'ASC')
      .offset(skip)
      .limit(take)
      .getRawMany<ReferenceCentreRow>();
    return { items, meta: buildMeta(q, total) };
  }

  /* ---- technology tracks ---- */

  private tracks(manager?: EntityManager): SelectQueryBuilder<TechnologyTrack> {
    return this.repo(TechnologyTrack, manager).createQueryBuilder('t').where('t.isDelete = false');
  }

  async listTracks(q: ReferenceTrackListQuery): Promise<Paginated<TechnologyTrack>> {
    const qb = this.tracks();
    if (q.search) {
      const term = likePattern(q.search);
      /*
       * The aliases are the names the external registration form uses for the track (F-ADM-15-03). Each alias is
       * matched on its own (CHK_technology_tracks_aliases keeps the column a JSON array): matching the array's
       * JSON text instead would let a search for `[`, `"` or `,` return every track.
       */
      qb.andWhere(new Brackets((w) => w
        .where('t.name ILIKE :term', { term })
        .orWhere('t.code ILIKE :term', { term })
        .orWhere('EXISTS (SELECT 1 FROM jsonb_array_elements_text("t"."aliases") AS "alias"("value") WHERE "alias"."value" ILIKE :term)', { term })));
    }
    if (q.isActive !== undefined) qb.andWhere('t.isActive = :isActive', { isActive: q.isActive });
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.orderBy(TRACK_SORT_SQL[q.sortBy], q.sortOrder).addOrderBy('t.id').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /* ---- dropdown feeds (R1): active, non-deleted rows only ---- */

  /*
   * entityId narrows the feed to the centres / tracks enabled for that LMS entity (non-deleted selection rows of
   * lms_entity_centres / lms_entity_tracks), so a master that stores a centre or track next to an entityId can
   * offer exactly what its server check (entity.refs.ts) accepts without the Entity Master's view permission.
   */
  selectableCentres(entityId?: string, manager?: EntityManager): Promise<TrainingCentre[]> {
    const qb = this.repo(TrainingCentre, manager)
      .createQueryBuilder('tc')
      .innerJoinAndSelect('tc.district', 'd')
      .where('tc.isDelete = false')
      .andWhere('tc.isActive = true');
    if (entityId) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM "lms_entity_centres" "ec" WHERE "ec"."centreId" = "tc"."id" AND "ec"."entityId" = :entityId AND "ec"."isDelete" = false)',
        { entityId },
      );
    }
    return qb.orderBy('tc.name', 'ASC').addOrderBy('tc.code', 'ASC').getMany();
  }

  selectableTracks(entityId?: string, manager?: EntityManager): Promise<TechnologyTrack[]> {
    const qb = this.tracks(manager).andWhere('t.isActive = true');
    if (entityId) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM "lms_entity_tracks" "et" WHERE "et"."trackId" = "t"."id" AND "et"."entityId" = :entityId AND "et"."isDelete" = false)',
        { entityId },
      );
    }
    return qb.orderBy('t.sortOrder', 'ASC').addOrderBy('t.code', 'ASC').getMany();
  }

  /* ---- summary ---- */

  /*
   * Counts over the non-deleted rows of a source table. lastUpdatedAt spans every row, deleted ones included:
   * a deletion in the Admin Panel is a change to the dataset too, and soft delete refreshes updatedAt.
   */
  counts(target: EntityTarget<ObjectLiteral>, manager?: EntityManager): Promise<ReferenceCountsRow> {
    return this.repo(target, manager)
      .createQueryBuilder('x')
      .select('COUNT(*) FILTER (WHERE "x"."isDelete" = false)::int', 'total')
      .addSelect('COUNT(*) FILTER (WHERE "x"."isDelete" = false AND "x"."isActive" = true)::int', 'active')
      .addSelect('MAX("x"."updatedAt")', 'lastUpdatedAt')
      .getRawOne<ReferenceCountsRow>()
      .then((r) => r ?? { total: 0, active: 0, lastUpdatedAt: null });
  }

  /* Latest change of any capacity & infrastructure record: it feeds the centres' capacity columns. */
  async infrastructureLastUpdatedAt(manager?: EntityManager): Promise<Date | null> {
    return (await this.counts(CentreInfrastructure, manager)).lastUpdatedAt;
  }
}

export const referenceRepository = new ReferenceRepository();
