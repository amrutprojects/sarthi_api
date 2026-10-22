import type { EntityManager } from 'typeorm';
import { Brackets } from 'typeorm';
import { Department } from './department.model';
import { BaseRepository } from '../../database/base.repository';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../shared/utils/pagination';
import type { DepartmentListQuery } from './department.types';

export class DepartmentRepository extends BaseRepository<Department> {
  constructor() {
    super(Department);
  }

  /* Matches the unique index on code (non-deleted rows). excludeId skips the row being updated. */
  findByCode(code: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<Department | null> {
    const qb = this.query('dp', opts.manager).andWhere('dp.code = :code', { code });
    if (opts.excludeId) qb.andWhere('dp.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  /* Matches the unique index on lower("name"), so the service can answer with a readable 409. */
  findByName(name: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<Department | null> {
    const qb = this.query('dp', opts.manager).andWhere('lower(dp.name) = lower(:name)', { name });
    if (opts.excludeId) qb.andWhere('dp.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  async list(q: DepartmentListQuery): Promise<Paginated<Department>> {
    const qb = this.query('dp');
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(new Brackets((w) => w.where('dp.name ILIKE :term', { term }).orWhere('dp.code ILIKE :term', { term })));
    }
    if (q.isActive !== undefined) qb.andWhere('dp.isActive = :isActive', { isActive: q.isActive });
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.orderBy(`dp.${q.sortBy}`, q.sortOrder).addOrderBy('dp.id').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /* Departments offered in a dropdown: not deleted and active. */
  findSelectable(manager?: EntityManager): Promise<Department[]> {
    return this.findMany({ isActive: true }, { order: { name: 'ASC' }, manager });
  }
}

export const departmentRepository = new DepartmentRepository();
