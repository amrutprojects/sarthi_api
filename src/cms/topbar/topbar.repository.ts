import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import { TopBarLink, TopBarSettings } from './topbar.model';

/* The Top Bar links. A short list, so reads return it whole, in display order — there is no paging. */
export class TopBarLinkRepository extends BaseRepository<TopBarLink> {
  constructor() {
    super(TopBarLink);
  }

  /* `activeOnly` separates the website's read from the admin's: hidden links are edited, never shown. */
  list(opts: { activeOnly?: boolean; manager?: EntityManager } = {}): Promise<TopBarLink[]> {
    const qb = this.query('l', opts.manager).orderBy('l.displayOrder', 'ASC').addOrderBy('l.createdAt', 'ASC');
    if (opts.activeOnly) qb.andWhere('l.isActive = true');
    return qb.getMany();
  }

  /* One link, locked for the rest of the caller's transaction, so two saves of it are serialised. */
  findForUpdate(id: string, manager: EntityManager): Promise<TopBarLink | null> {
    return this.query('l', manager).andWhere('l.id = :id', { id }).setLock('pessimistic_write').getOne();
  }

  /* Every link, locked: a reorder rewrites them all. */
  lockAll(manager: EntityManager): Promise<TopBarLink[]> {
    return this.query('l', manager).setLock('pessimistic_write').getMany();
  }

  async maxOrder(manager?: EntityManager): Promise<number> {
    const row = await this.query('l', manager).select('COALESCE(MAX(l.displayOrder), 0)', 'max').getRawOne<{ max: number | string }>();
    return Number(row?.max ?? 0);
  }
}

/* The Top Bar's settings: a singleton, so the only read that matters is "the one live row". */
export class TopBarSettingsRepository extends BaseRepository<TopBarSettings> {
  constructor() {
    super(TopBarSettings);
  }

  find(manager?: EntityManager): Promise<TopBarSettings | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').getOne();
  }

  findForUpdate(manager: EntityManager): Promise<TopBarSettings | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').setLock('pessimistic_write').getOne();
  }
}

export const topBarLinkRepository = new TopBarLinkRepository();
export const topBarSettingsRepository = new TopBarSettingsRepository();
