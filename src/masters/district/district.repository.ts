import type { EntityManager, SelectQueryBuilder } from 'typeorm';
import { Brackets } from 'typeorm';
import { District } from './district.model';
import { Taluka } from '../taluka/taluka.model';
import { BaseRepository } from '../../repositories/base.repository';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../utils/pagination';
import type { DistrictListQuery, DistrictSortField } from './district.types';

/* sortBy to SQL expression, so the state name is sortable without exposing a column name to clients. */
const SORT_SQL: Record<DistrictSortField, string> = {
  name: 'd.name',
  code: 'd.code',
  stateName: 's.name',
  createdAt: 'd.createdAt',
  updatedAt: 'd.updatedAt',
};


export class DistrictRepository extends BaseRepository<District> {
  constructor() {
    super(District);
  }

  /* Districts are always read with their state: every list and detail response carries the state name. */
  private withState(manager?: EntityManager): SelectQueryBuilder<District> {
    return this.query('d', manager).innerJoinAndSelect('d.state', 's');
  }

  findByIdWithState(id: string, manager?: EntityManager): Promise<District | null> {
    return this.withState(manager).andWhere('d.id = :id', { id }).getOne();
  }

  /* Name uniqueness is per state, matching the (stateId, lower("name")) unique index. */
  findByNameInState(stateId: string, name: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<District | null> {
    const qb = this.query('d', opts.manager)
      .andWhere('d.stateId = :stateId', { stateId })
      .andWhere('lower(d.name) = lower(:name)', { name });
    if (opts.excludeId) qb.andWhere('d.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  findByCodeInState(stateId: string, code: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<District | null> {
    const qb = this.query('d', opts.manager)
      .andWhere('d.stateId = :stateId', { stateId })
      .andWhere('d.code = :code', { code });
    if (opts.excludeId) qb.andWhere('d.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  async list(q: DistrictListQuery): Promise<Paginated<District>> {
    const qb = this.withState();
    if (q.stateId) qb.andWhere('d.stateId = :stateId', { stateId: q.stateId });
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(new Brackets((w) => w
        .where('d.name ILIKE :term', { term })
        .orWhere('d.code ILIKE :term', { term })
        .orWhere('s.name ILIKE :term', { term })));
    }
    if (q.isActive !== undefined) qb.andWhere('d.isActive = :isActive', { isActive: q.isActive });
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.orderBy(SORT_SQL[q.sortBy], q.sortOrder).addOrderBy('d.id').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /* Districts offered in a dropdown: not deleted and active. */
  findSelectable(stateId: string, manager?: EntityManager): Promise<District[]> {
    return this.withState(manager)
      .andWhere('d.stateId = :stateId', { stateId })
      .andWhere('d.isActive = true')
      .orderBy('d.name', 'ASC')
      .getMany();
  }

  /* Talukas still attached to the district. Guards deletion and deactivation. */
  countTalukas(districtId: string, opts: { activeOnly?: boolean; manager?: EntityManager } = {}): Promise<number> {
    const where = { districtId, isDelete: false, ...(opts.activeOnly ? { isActive: true } : {}) };
    return (opts.manager ?? this.repo().manager).getRepository(Taluka).count({ where });
  }
}

export const districtRepository = new DistrictRepository();
