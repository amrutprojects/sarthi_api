import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import type { AppBaseEntity } from '../../database/base.entity';
import { LiveDashboardCard, LiveDashboardDistrict, LiveDashboardSettings, LiveDashboardStat } from './livedashboard.model';

/*
 * A short ordered list (the KPI cards, the side figures): reads return it whole, in display order —
 * there is no paging.
 */
export class OrderedListRepository<T extends AppBaseEntity & { displayOrder: number }> extends BaseRepository<T> {
  /* `activeOnly` separates the website's read from the admin's: hidden rows are edited, never shown. */
  list(opts: { activeOnly?: boolean; manager?: EntityManager } = {}): Promise<T[]> {
    const qb = this.query('r', opts.manager).orderBy('r.displayOrder', 'ASC').addOrderBy('r.createdAt', 'ASC');
    if (opts.activeOnly) qb.andWhere('r.isActive = true');
    return qb.getMany();
  }

  /* One row, locked for the rest of the caller's transaction, so two saves of it are serialised. */
  findForUpdate(id: string, manager: EntityManager): Promise<T | null> {
    return this.query('r', manager).andWhere('r.id = :id', { id }).setLock('pessimistic_write').getOne();
  }

  /* Every row, locked: a reorder rewrites them all. */
  lockAll(manager: EntityManager): Promise<T[]> {
    return this.query('r', manager).setLock('pessimistic_write').getMany();
  }

  async maxOrder(manager?: EntityManager): Promise<number> {
    const row = await this.query('r', manager).select('COALESCE(MAX(r.displayOrder), 0)', 'max').getRawOne<{ max: number | string }>();
    return Number(row?.max ?? 0);
  }
}

export class LiveDashboardDistrictRepository extends BaseRepository<LiveDashboardDistrict> {
  constructor() {
    super(LiveDashboardDistrict);
  }

  list(opts: { activeOnly?: boolean } = {}): Promise<LiveDashboardDistrict[]> {
    const qb = this.query('d').orderBy('d.displayOrder', 'ASC').addOrderBy('d.districtCode', 'ASC');
    if (opts.activeOnly) qb.andWhere('d.isActive = true');
    return qb.getMany();
  }

  findByCode(code: string, manager?: EntityManager): Promise<LiveDashboardDistrict | null> {
    return this.query('d', manager).andWhere('d.districtCode = :code', { code }).getOne();
  }

  findByCodeForUpdate(code: string, manager: EntityManager): Promise<LiveDashboardDistrict | null> {
    return this.query('d', manager).andWhere('d.districtCode = :code', { code }).setLock('pessimistic_write').getOne();
  }
}

/* The section's settings: a singleton, so the only read that matters is "the one live row". */
export class LiveDashboardSettingsRepository extends BaseRepository<LiveDashboardSettings> {
  constructor() {
    super(LiveDashboardSettings);
  }

  find(manager?: EntityManager): Promise<LiveDashboardSettings | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').getOne();
  }

  findForUpdate(manager: EntityManager): Promise<LiveDashboardSettings | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').setLock('pessimistic_write').getOne();
  }
}

export const liveDashboardSettingsRepository = new LiveDashboardSettingsRepository();
export const liveDashboardCardRepository = new OrderedListRepository<LiveDashboardCard>(LiveDashboardCard);
export const liveDashboardStatRepository = new OrderedListRepository<LiveDashboardStat>(LiveDashboardStat);
export const liveDashboardDistrictRepository = new LiveDashboardDistrictRepository();
