import type { EntityManager } from 'typeorm';
import { Brackets } from 'typeorm';
import { CentreType } from './centre-type.model';
import { BaseRepository } from '../../database/base.repository';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../shared/utils/pagination';
import type { CentreTypeListQuery } from './centre-type.types';

export class CentreTypeRepository extends BaseRepository<CentreType> {
  constructor() {
    super(CentreType);
  }

  /* Matches the unique index on code (non-deleted rows). excludeId skips the row being updated. */
  findByCode(code: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<CentreType | null> {
    const qb = this.query('ct', opts.manager).andWhere('ct.code = :code', { code });
    if (opts.excludeId) qb.andWhere('ct.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  /* Matches the unique index on lower("name"), so the service can answer with a readable 409. */
  findByName(name: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<CentreType | null> {
    const qb = this.query('ct', opts.manager).andWhere('lower(ct.name) = lower(:name)', { name });
    if (opts.excludeId) qb.andWhere('ct.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  async list(q: CentreTypeListQuery): Promise<Paginated<CentreType>> {
    const qb = this.query('ct');
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(new Brackets((w) => w.where('ct.name ILIKE :term', { term }).orWhere('ct.code ILIKE :term', { term })));
    }
    if (q.isActive !== undefined) qb.andWhere('ct.isActive = :isActive', { isActive: q.isActive });
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.orderBy(`ct.${q.sortBy}`, q.sortOrder).addOrderBy('ct.id').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /* Centre types offered in a dropdown: not deleted and active. */
  findSelectable(manager?: EntityManager): Promise<CentreType[]> {
    return this.findMany({ isActive: true }, { order: { name: 'ASC' }, manager });
  }
}

export const centreTypeRepository = new CentreTypeRepository();
