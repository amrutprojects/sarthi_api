import type { EntityManager, SelectQueryBuilder } from 'typeorm';
import { Brackets } from 'typeorm';
import { Taluka } from './taluka.model';
import { BaseRepository } from '../../database/base.repository';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../shared/utils/pagination';
import type { TalukaListQuery, TalukaSortField } from './taluka.types';

const SORT_SQL: Record<TalukaSortField, string> = {
  name: 't.name',
  code: 't.code',
  districtName: 'd.name',
  stateName: 's.name',
  createdAt: 't.createdAt',
  updatedAt: 't.updatedAt',
};


export class TalukaRepository extends BaseRepository<Taluka> {
  constructor() {
    super(Taluka);
  }

  /* The state is reached through the district: a taluka holds no state column of its own. */
  private withParents(manager?: EntityManager): SelectQueryBuilder<Taluka> {
    return this.query('t', manager).innerJoinAndSelect('t.district', 'd').innerJoinAndSelect('d.state', 's');
  }

  findByIdWithParents(id: string, manager?: EntityManager): Promise<Taluka | null> {
    return this.withParents(manager).andWhere('t.id = :id', { id }).getOne();
  }

  findByNameInDistrict(districtId: string, name: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<Taluka | null> {
    const qb = this.query('t', opts.manager)
      .andWhere('t.districtId = :districtId', { districtId })
      .andWhere('lower(t.name) = lower(:name)', { name });
    if (opts.excludeId) qb.andWhere('t.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  findByCodeInDistrict(districtId: string, code: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<Taluka | null> {
    const qb = this.query('t', opts.manager)
      .andWhere('t.districtId = :districtId', { districtId })
      .andWhere('t.code = :code', { code });
    if (opts.excludeId) qb.andWhere('t.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  async list(q: TalukaListQuery): Promise<Paginated<Taluka>> {
    const qb = this.withParents();
    if (q.districtId) qb.andWhere('t.districtId = :districtId', { districtId: q.districtId });
    if (q.stateId) qb.andWhere('d.stateId = :stateId', { stateId: q.stateId });
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(new Brackets((w) => w
        .where('t.name ILIKE :term', { term })
        .orWhere('t.code ILIKE :term', { term })
        .orWhere('d.name ILIKE :term', { term })
        .orWhere('s.name ILIKE :term', { term })));
    }
    if (q.isActive !== undefined) qb.andWhere('t.isActive = :isActive', { isActive: q.isActive });
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.orderBy(SORT_SQL[q.sortBy], q.sortOrder).addOrderBy('t.id').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /* Talukas offered in a dropdown: not deleted and active. */
  findSelectable(districtId: string, manager?: EntityManager): Promise<Taluka[]> {
    return this.withParents(manager)
      .andWhere('t.districtId = :districtId', { districtId })
      .andWhere('t.isActive = true')
      .orderBy('t.name', 'ASC')
      .getMany();
  }
}

export const talukaRepository = new TalukaRepository();
