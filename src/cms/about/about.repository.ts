import type { EntityManager, ObjectLiteral } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import type { AppBaseEntity } from '../../database/base.entity';
import { AboutCard, AboutFact, AboutSection } from './about.model';

/*
 * The information rows and the cards are short lists with the same shape (a pair of bilingual
 * texts, an order and a status), so one repository serves both. `first` is the column prefix of the
 * text that must be unique — the row's label, the card's heading.
 */
export class AboutItemRepository<T extends AppBaseEntity & ObjectLiteral & { displayOrder: number }> extends BaseRepository<T> {
  constructor(
    target: new () => T,
    private readonly first: 'label' | 'heading',
  ) {
    super(target);
  }

  /* `activeOnly` separates the website's read from the admin's: hidden records are edited, never shown. */
  list(opts: { activeOnly?: boolean; manager?: EntityManager } = {}): Promise<T[]> {
    const qb = this.query('i', opts.manager).orderBy('i.displayOrder', 'ASC').addOrderBy('i.createdAt', 'ASC');
    if (opts.activeOnly) qb.andWhere('i.isActive = true');
    return qb.getMany();
  }

  /* One record, locked for the rest of the caller's transaction, so two saves of it are serialised. */
  findForUpdate(id: string, manager: EntityManager): Promise<T | null> {
    return this.query('i', manager).andWhere('i.id = :id', { id }).setLock('pessimistic_write').getOne();
  }

  /* Every record, locked: a reorder rewrites them all. */
  lockAll(manager: EntityManager): Promise<T[]> {
    return this.query('i', manager).setLock('pessimistic_write').getMany();
  }

  /* A record already using this label / heading in either language (case-insensitive), other than `exceptId`. */
  findClash(text: { mr: string; en: string }, exceptId: string | undefined, manager: EntityManager): Promise<T | null> {
    const qb = this.query('i', manager).andWhere(`(lower(i.${this.first}Mr) = lower(:mr) OR lower(i.${this.first}En) = lower(:en))`, text);
    if (exceptId) qb.andWhere('i.id <> :exceptId', { exceptId });
    return qb.getOne();
  }

  async maxOrder(manager?: EntityManager): Promise<number> {
    const row = await this.query('i', manager).select('COALESCE(MAX(i.displayOrder), 0)', 'max').getRawOne<{ max: number | string }>();
    return Number(row?.max ?? 0);
  }
}

/* The section's settings: a singleton, so the only read that matters is "the one live row". */
export class AboutSectionRepository extends BaseRepository<AboutSection> {
  constructor() {
    super(AboutSection);
  }

  find(manager?: EntityManager): Promise<AboutSection | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').getOne();
  }

  findForUpdate(manager: EntityManager): Promise<AboutSection | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').setLock('pessimistic_write').getOne();
  }
}

export const aboutSectionRepository = new AboutSectionRepository();
export const aboutFactRepository = new AboutItemRepository(AboutFact, 'label');
export const aboutCardRepository = new AboutItemRepository(AboutCard, 'heading');
