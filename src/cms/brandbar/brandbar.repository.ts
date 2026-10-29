import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import { BrandBarSettings } from './brandbar.model';

/* The Brand Bar: a singleton, so the only read that matters is "the one live row". */
export class BrandBarSettingsRepository extends BaseRepository<BrandBarSettings> {
  constructor() {
    super(BrandBarSettings);
  }

  find(manager?: EntityManager): Promise<BrandBarSettings | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').getOne();
  }

  findForUpdate(manager: EntityManager): Promise<BrandBarSettings | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').setLock('pessimistic_write').getOne();
  }
}

export const brandBarSettingsRepository = new BrandBarSettingsRepository();
