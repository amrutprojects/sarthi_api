import type { EntityManager } from 'typeorm';
import { Brackets } from 'typeorm';
import { District } from '../district/district.model';
import { State } from './state.model';
import { BaseRepository } from '../../../repositories/base.repository';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../../utils/pagination';
import type { StateListQuery } from './state.types';

export class StateRepository extends BaseRepository<State> {
  constructor() {
    super(State);
  }

  findByCode(code: string, manager?: EntityManager): Promise<State | null> {
    return this.findOne({ code }, manager);
  }

  /*
   * Name lookup matching the unique index of the table (lower("name")), so the service can answer with
   * a readable 409 instead of letting the constraint raise one. excludeId skips the row being updated.
   */
  findByName(name: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<State | null> {
    const qb = this.query('s', opts.manager).andWhere('lower(s.name) = lower(:name)', { name });
    if (opts.excludeId) qb.andWhere('s.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  async list(q: StateListQuery): Promise<Paginated<State>> {
    const qb = this.query('s');
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(new Brackets((w) => w.where('s.name ILIKE :term', { term }).orWhere('s.code ILIKE :term', { term })));
    }
    if (q.isActive !== undefined) qb.andWhere('s.isActive = :isActive', { isActive: q.isActive });
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.orderBy(`s.${q.sortBy}`, q.sortOrder).addOrderBy('s.id').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /* States offered in a dropdown: not deleted and active. */
  findSelectable(manager?: EntityManager): Promise<State[]> {
    return this.findMany({ isActive: true }, { order: { name: 'ASC' }, manager });
  }

  /* Districts still attached to the state. Guards deletion and deactivation. */
  countDistricts(stateId: string, opts: { activeOnly?: boolean; manager?: EntityManager } = {}): Promise<number> {
    const where = { stateId, isDelete: false, ...(opts.activeOnly ? { isActive: true } : {}) };
    return (opts.manager ?? this.repo().manager).getRepository(District).count({ where });
  }
}

export const stateRepository = new StateRepository();
