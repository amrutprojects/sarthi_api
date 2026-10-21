import type { EntityManager, SelectQueryBuilder } from 'typeorm';
import { Brackets } from 'typeorm';
import { CentreLocation } from './centre-location.model';
import { BaseRepository } from '../../database/base.repository';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../shared/utils/pagination';
import type { CentreLocationListQuery, CentreLocationSortField } from './centre-location.types';

/* sortBy to SQL expression, so the centre name and code are sortable without exposing column names. */
const SORT_SQL: Record<CentreLocationSortField, string> = {
  centreName: 'c.name',
  centreCode: 'c.code',
  createdAt: 'l.createdAt',
  updatedAt: 'l.updatedAt',
};

export class CentreLocationRepository extends BaseRepository<CentreLocation> {
  constructor() {
    super(CentreLocation);
  }

  /* Always read with the training centre: every response carries its name and code. */
  private withCentre(manager?: EntityManager): SelectQueryBuilder<CentreLocation> {
    return this.query('l', manager).innerJoinAndSelect('l.centre', 'c');
  }

  findByIdWithCentre(id: string, manager?: EntityManager): Promise<CentreLocation | null> {
    return this.withCentre(manager).andWhere('l.id = :id', { id }).getOne();
  }

  /* Matches the unique index on centreId (non-deleted rows): one location record per centre. */
  findByCentre(centreId: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<CentreLocation | null> {
    const qb = this.query('l', opts.manager).andWhere('l.centreId = :centreId', { centreId });
    if (opts.excludeId) qb.andWhere('l.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  async list(q: CentreLocationListQuery): Promise<Paginated<CentreLocation>> {
    const qb = this.withCentre();
    if (q.centreId) qb.andWhere('l.centreId = :centreId', { centreId: q.centreId });
    if (q.parking) qb.andWhere('l.parking = :parking', { parking: q.parking });
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(new Brackets((w) => w
        .where('c.name ILIKE :term', { term })
        .orWhere('c.code ILIKE :term', { term })
        .orWhere('l.address ILIKE :term', { term })
        .orWhere('l.nearestLandmark ILIKE :term', { term })));
    }
    if (q.isActive !== undefined) qb.andWhere('l.isActive = :isActive', { isActive: q.isActive });
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.orderBy(SORT_SQL[q.sortBy], q.sortOrder).addOrderBy('l.id').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }
}

export const centreLocationRepository = new CentreLocationRepository();
