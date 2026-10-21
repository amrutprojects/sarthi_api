import type { EntityManager, SelectQueryBuilder } from 'typeorm';
import { Brackets } from 'typeorm';
import { College } from './college.model';
import { BaseRepository } from '../../database/base.repository';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../shared/utils/pagination';
import type { CollegeListQuery, CollegeSortField } from './college.types';

/* sortBy to SQL expression, so the district name is sortable without exposing a column name to clients. */
const SORT_SQL: Record<CollegeSortField, string> = {
  name: 'c.name',
  code: 'c.code',
  districtName: 'd.name',
  createdAt: 'c.createdAt',
  updatedAt: 'c.updatedAt',
};

export class CollegeRepository extends BaseRepository<College> {
  constructor() {
    super(College);
  }

  /*
   * Colleges are always read with their parents: every list and detail response carries the district,
   * its state and (when set) the taluka by name. The taluka is optional, hence the left join.
   */
  private withParents(manager?: EntityManager): SelectQueryBuilder<College> {
    return this.query('c', manager)
      .innerJoinAndSelect('c.district', 'd')
      .innerJoinAndSelect('d.state', 's')
      .leftJoinAndSelect('c.taluka', 't');
  }

  findByIdWithParents(id: string, manager?: EntityManager): Promise<College | null> {
    return this.withParents(manager).andWhere('c.id = :id', { id }).getOne();
  }

  /* Name uniqueness is per district, matching the (districtId, lower("name")) unique index. */
  findByNameInDistrict(districtId: string, name: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<College | null> {
    const qb = this.query('c', opts.manager)
      .andWhere('c.districtId = :districtId', { districtId })
      .andWhere('lower(c.name) = lower(:name)', { name });
    if (opts.excludeId) qb.andWhere('c.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  /* Matches the unique index on code (non-deleted rows): codes are unique across all districts. */
  findByCode(code: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<College | null> {
    const qb = this.query('c', opts.manager).andWhere('c.code = :code', { code });
    if (opts.excludeId) qb.andWhere('c.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  async list(q: CollegeListQuery): Promise<Paginated<College>> {
    const qb = this.withParents();
    if (q.districtId) qb.andWhere('c.districtId = :districtId', { districtId: q.districtId });
    if (q.stateId) qb.andWhere('d.stateId = :stateId', { stateId: q.stateId });
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(new Brackets((w) => w
        .where('c.name ILIKE :term', { term })
        .orWhere('c.code ILIKE :term', { term })
        .orWhere('d.name ILIKE :term', { term })));
    }
    if (q.isActive !== undefined) qb.andWhere('c.isActive = :isActive', { isActive: q.isActive });
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.orderBy(SORT_SQL[q.sortBy], q.sortOrder).addOrderBy('c.id').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /* Colleges offered in a dropdown: not deleted and active. */
  findSelectable(manager?: EntityManager): Promise<College[]> {
    return this.findMany({ isActive: true }, { order: { name: 'ASC' }, manager });
  }
}

export const collegeRepository = new CollegeRepository();
