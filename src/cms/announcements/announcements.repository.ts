import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import { Announcement, AnnouncementSettings } from './announcements.model';

/* The announcements. A short list, so reads return it whole, in display order — there is no paging. */
export class AnnouncementRepository extends BaseRepository<Announcement> {
  constructor() {
    super(Announcement);
  }

  /* `activeOnly` separates the website's read from the admin's: hidden announcements are edited, never shown. */
  list(opts: { activeOnly?: boolean; manager?: EntityManager } = {}): Promise<Announcement[]> {
    const qb = this.query('a', opts.manager).orderBy('a.displayOrder', 'ASC').addOrderBy('a.createdAt', 'ASC');
    if (opts.activeOnly) qb.andWhere('a.isActive = true');
    return qb.getMany();
  }

  /* One announcement, locked for the rest of the caller's transaction, so two saves of it are serialised. */
  findForUpdate(id: string, manager: EntityManager): Promise<Announcement | null> {
    return this.query('a', manager).andWhere('a.id = :id', { id }).setLock('pessimistic_write').getOne();
  }

  /* Every announcement, locked: a reorder rewrites them all. */
  lockAll(manager: EntityManager): Promise<Announcement[]> {
    return this.query('a', manager).setLock('pessimistic_write').getMany();
  }

  async maxOrder(manager?: EntityManager): Promise<number> {
    const row = await this.query('a', manager).select('COALESCE(MAX(a.displayOrder), 0)', 'max').getRawOne<{ max: number | string }>();
    return Number(row?.max ?? 0);
  }
}

/* The ticker's settings: a singleton, so the only read that matters is "the one live row". */
export class AnnouncementSettingsRepository extends BaseRepository<AnnouncementSettings> {
  constructor() {
    super(AnnouncementSettings);
  }

  find(manager?: EntityManager): Promise<AnnouncementSettings | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').getOne();
  }

  findForUpdate(manager: EntityManager): Promise<AnnouncementSettings | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').setLock('pessimistic_write').getOne();
  }
}

export const announcementRepository = new AnnouncementRepository();
export const announcementSettingsRepository = new AnnouncementSettingsRepository();
