import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import { EcosystemProgramme, EcosystemSection } from './ecosystem.model';

/* The programme cards. A short list, so reads return it whole, in display order — there is no paging. */
export class EcosystemProgrammeRepository extends BaseRepository<EcosystemProgramme> {
  constructor() {
    super(EcosystemProgramme);
  }

  /* `activeOnly` separates the website's read from the admin's: hidden cards are edited, never shown. */
  list(opts: { activeOnly?: boolean; manager?: EntityManager } = {}): Promise<EcosystemProgramme[]> {
    const qb = this.query('p', opts.manager).orderBy('p.displayOrder', 'ASC').addOrderBy('p.createdAt', 'ASC');
    if (opts.activeOnly) qb.andWhere('p.isActive = true');
    return qb.getMany();
  }

  /* One card, locked for the rest of the caller's transaction, so two saves of it are serialised. */
  findForUpdate(id: string, manager: EntityManager): Promise<EcosystemProgramme | null> {
    return this.query('p', manager).andWhere('p.id = :id', { id }).setLock('pessimistic_write').getOne();
  }

  /* Every card, locked: a reorder rewrites them all. */
  lockAll(manager: EntityManager): Promise<EcosystemProgramme[]> {
    return this.query('p', manager).setLock('pessimistic_write').getMany();
  }

  /* A card already using this name in either language (case-insensitive), other than `exceptId`. */
  findByName(name: { mr: string; en: string }, exceptId?: string, manager?: EntityManager): Promise<EcosystemProgramme | null> {
    const qb = this.query('p', manager).andWhere('(lower(p.nameMr) = lower(:mr) OR lower(p.nameEn) = lower(:en))', name);
    if (exceptId) qb.andWhere('p.id <> :exceptId', { exceptId });
    return qb.getOne();
  }

  async maxOrder(manager?: EntityManager): Promise<number> {
    const row = await this.query('p', manager).select('COALESCE(MAX(p.displayOrder), 0)', 'max').getRawOne<{ max: number | string }>();
    return Number(row?.max ?? 0);
  }
}

/* The section's settings: a singleton, so the only read that matters is "the one live row". */
export class EcosystemSectionRepository extends BaseRepository<EcosystemSection> {
  constructor() {
    super(EcosystemSection);
  }

  find(manager?: EntityManager): Promise<EcosystemSection | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').getOne();
  }

  findForUpdate(manager: EntityManager): Promise<EcosystemSection | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').setLock('pessimistic_write').getOne();
  }
}

export const ecosystemProgrammeRepository = new EcosystemProgrammeRepository();
export const ecosystemSectionRepository = new EcosystemSectionRepository();
