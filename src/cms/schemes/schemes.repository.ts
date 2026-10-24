import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import { AmrutScheme, AmrutSchemesSection } from './schemes.model';

/* The scheme cards. A short list, so reads return it whole, in display order — there is no paging. */
export class AmrutSchemeRepository extends BaseRepository<AmrutScheme> {
  constructor() {
    super(AmrutScheme);
  }

  /* `activeOnly` separates the website's read from the admin's: hidden schemes are edited, never shown. */
  list(opts: { activeOnly?: boolean; manager?: EntityManager } = {}): Promise<AmrutScheme[]> {
    const qb = this.query('s', opts.manager).orderBy('s.displayOrder', 'ASC').addOrderBy('s.createdAt', 'ASC');
    if (opts.activeOnly) qb.andWhere('s.isActive = true');
    return qb.getMany();
  }

  /* One scheme, locked for the rest of the caller's transaction, so two saves of it are serialised. */
  findForUpdate(id: string, manager: EntityManager): Promise<AmrutScheme | null> {
    return this.query('s', manager).andWhere('s.id = :id', { id }).setLock('pessimistic_write').getOne();
  }

  /* Every scheme, locked: a reorder rewrites them all. */
  lockAll(manager: EntityManager): Promise<AmrutScheme[]> {
    return this.query('s', manager).setLock('pessimistic_write').getMany();
  }

  /* A scheme already using this title in either language (case-insensitive), other than `exceptId`. */
  findByTitle(title: { mr: string; en: string }, exceptId?: string, manager?: EntityManager): Promise<AmrutScheme | null> {
    const qb = this.query('s', manager).andWhere('(lower(s.titleMr) = lower(:mr) OR lower(s.titleEn) = lower(:en))', title);
    if (exceptId) qb.andWhere('s.id <> :exceptId', { exceptId });
    return qb.getOne();
  }

  async maxOrder(manager?: EntityManager): Promise<number> {
    const row = await this.query('s', manager).select('COALESCE(MAX(s.displayOrder), 0)', 'max').getRawOne<{ max: number | string }>();
    return Number(row?.max ?? 0);
  }
}

/* The section's settings: a singleton, so the only read that matters is "the one live row". */
export class AmrutSchemesSectionRepository extends BaseRepository<AmrutSchemesSection> {
  constructor() {
    super(AmrutSchemesSection);
  }

  find(manager?: EntityManager): Promise<AmrutSchemesSection | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').getOne();
  }

  findForUpdate(manager: EntityManager): Promise<AmrutSchemesSection | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').setLock('pessimistic_write').getOne();
  }
}

export const amrutSchemeRepository = new AmrutSchemeRepository();
export const amrutSchemesSectionRepository = new AmrutSchemesSectionRepository();
