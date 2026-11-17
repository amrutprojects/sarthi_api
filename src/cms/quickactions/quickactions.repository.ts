import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import { QuickAction, QuickActionSettings } from './quickactions.model';

/* The Quick Actions tiles. A short list, so reads return it whole, in display order — there is no paging. */
export class QuickActionRepository extends BaseRepository<QuickAction> {
  constructor() {
    super(QuickAction);
  }

  /* `activeOnly` separates the website's read from the admin's: hidden tiles are edited, never shown. */
  list(opts: { activeOnly?: boolean; manager?: EntityManager } = {}): Promise<QuickAction[]> {
    const qb = this.query('q', opts.manager).orderBy('q.displayOrder', 'ASC').addOrderBy('q.createdAt', 'ASC');
    if (opts.activeOnly) qb.andWhere('q.isActive = true');
    return qb.getMany();
  }

  /* One tile, locked for the rest of the caller's transaction, so two saves of it are serialised. */
  findForUpdate(id: string, manager: EntityManager): Promise<QuickAction | null> {
    return this.query('q', manager).andWhere('q.id = :id', { id }).setLock('pessimistic_write').getOne();
  }

  /* Every tile, locked: a reorder rewrites them all. */
  lockAll(manager: EntityManager): Promise<QuickAction[]> {
    return this.query('q', manager).setLock('pessimistic_write').getMany();
  }

  async maxOrder(manager?: EntityManager): Promise<number> {
    const row = await this.query('q', manager).select('COALESCE(MAX(q.displayOrder), 0)', 'max').getRawOne<{ max: number | string }>();
    return Number(row?.max ?? 0);
  }
}

/* The strip's settings: a singleton, so the only read that matters is "the one live row". */
export class QuickActionSettingsRepository extends BaseRepository<QuickActionSettings> {
  constructor() {
    super(QuickActionSettings);
  }

  find(manager?: EntityManager): Promise<QuickActionSettings | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').getOne();
  }
}

export const quickActionRepository = new QuickActionRepository();
export const quickActionSettingsRepository = new QuickActionSettingsRepository();
