import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import { ImpactSection, ImpactStat } from './impact.model';

/* The statistic cards. A short list, so reads return it whole, in display order — there is no paging. */
export class ImpactStatRepository extends BaseRepository<ImpactStat> {
  constructor() {
    super(ImpactStat);
  }

  /* `activeOnly` separates the website's read from the admin's: hidden cards are edited, never shown. */
  list(opts: { activeOnly?: boolean; manager?: EntityManager } = {}): Promise<ImpactStat[]> {
    const qb = this.query('s', opts.manager).orderBy('s.displayOrder', 'ASC').addOrderBy('s.createdAt', 'ASC');
    if (opts.activeOnly) qb.andWhere('s.isActive = true');
    return qb.getMany();
  }

  /* One card, locked for the rest of the caller's transaction, so two saves of it are serialised. */
  findForUpdate(id: string, manager: EntityManager): Promise<ImpactStat | null> {
    return this.query('s', manager).andWhere('s.id = :id', { id }).setLock('pessimistic_write').getOne();
  }

  /* Every card, locked: a reorder rewrites them all. */
  lockAll(manager: EntityManager): Promise<ImpactStat[]> {
    return this.query('s', manager).setLock('pessimistic_write').getMany();
  }

  async maxOrder(manager?: EntityManager): Promise<number> {
    const row = await this.query('s', manager).select('COALESCE(MAX(s.displayOrder), 0)', 'max').getRawOne<{ max: number | string }>();
    return Number(row?.max ?? 0);
  }
}

/* The section's settings: a singleton, so the only read that matters is "the one live row". */
export class ImpactSectionRepository extends BaseRepository<ImpactSection> {
  constructor() {
    super(ImpactSection);
  }

  find(manager?: EntityManager): Promise<ImpactSection | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').getOne();
  }

  findForUpdate(manager: EntityManager): Promise<ImpactSection | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').setLock('pessimistic_write').getOne();
  }
}

export const impactStatRepository = new ImpactStatRepository();
export const impactSectionRepository = new ImpactSectionRepository();
