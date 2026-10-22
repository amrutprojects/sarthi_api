import type { EntityManager, SelectQueryBuilder } from 'typeorm';
import { Brackets } from 'typeorm';
import { CentreInfrastructure } from './centre-infrastructure.model';
import { BaseRepository } from '../../database/base.repository';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../shared/utils/pagination';
import type { CentreInfrastructureListQuery, CentreInfrastructureSortField } from './centre-infrastructure.types';

/* sortBy to SQL expression, so the centre name and code are sortable without exposing column names. */
const SORT_SQL: Record<CentreInfrastructureSortField, string> = {
  centreName: 'c.name',
  centreCode: 'c.code',
  maxSeatingCapacity: 'ci.maxSeatingCapacity',
  createdAt: 'ci.createdAt',
  updatedAt: 'ci.updatedAt',
};

export class CentreInfrastructureRepository extends BaseRepository<CentreInfrastructure> {
  constructor() {
    super(CentreInfrastructure);
  }

  /* Always read with the training centre: every response carries its name and code. */
  private withCentre(manager?: EntityManager): SelectQueryBuilder<CentreInfrastructure> {
    return this.query('ci', manager).innerJoinAndSelect('ci.centre', 'c');
  }

  findByIdWithCentre(id: string, manager?: EntityManager): Promise<CentreInfrastructure | null> {
    return this.withCentre(manager).andWhere('ci.id = :id', { id }).getOne();
  }

  /* Matches the unique index on centreId (non-deleted rows): one infrastructure record per centre. */
  findByCentre(centreId: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<CentreInfrastructure | null> {
    const qb = this.query('ci', opts.manager).andWhere('ci.centreId = :centreId', { centreId });
    if (opts.excludeId) qb.andWhere('ci.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  async list(q: CentreInfrastructureListQuery): Promise<Paginated<CentreInfrastructure>> {
    const qb = this.withCentre();
    if (q.centreId) qb.andWhere('ci.centreId = :centreId', { centreId: q.centreId });
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(new Brackets((w) => w
        .where('c.name ILIKE :term', { term })
        .orWhere('c.code ILIKE :term', { term })
        .orWhere('ci.internetType ILIKE :term', { term })));
    }
    if (q.isActive !== undefined) qb.andWhere('ci.isActive = :isActive', { isActive: q.isActive });
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.orderBy(SORT_SQL[q.sortBy], q.sortOrder).addOrderBy('ci.id').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /* Record counts and the seating capacity of the active records, in one round trip (listing KPIs). */
  async summary(centreId?: string): Promise<{ total: number; active: number; activeSeatingCapacity: number }> {
    const qb = this.query('ci')
      .select('COUNT(*)', 'total')
      .addSelect('COUNT(*) FILTER (WHERE ci.isActive = true)', 'active')
      .addSelect('COALESCE(SUM(ci.maxSeatingCapacity) FILTER (WHERE ci.isActive = true), 0)', 'seating');
    if (centreId) qb.andWhere('ci.centreId = :centreId', { centreId });
    const row = await qb.getRawOne<{ total: string; active: string; seating: string }>();
    return { total: Number(row?.total ?? 0), active: Number(row?.active ?? 0), activeSeatingCapacity: Number(row?.seating ?? 0) };
  }
}

export const centreInfrastructureRepository = new CentreInfrastructureRepository();
