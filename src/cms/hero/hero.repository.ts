import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import { HomeHero, HomeHeroSlide } from './hero.model';

/*
 * The hero is a singleton, so this repository has no list or paging: the only read that matters is
 * "the one live configuration, with its slides".
 */
export class HeroRepository extends BaseRepository<HomeHero> {
  constructor() {
    super(HomeHero);
  }

  findSettings(manager?: EntityManager): Promise<HomeHero | null> {
    return this.query('h', manager).orderBy('h.createdAt', 'ASC').getOne();
  }

  /*
   * The same row, locked for the rest of the caller's transaction. A save that checks
   * `expectedUpdatedAt` reads through this, so two administrators saving at once are serialised and
   * the second one sees the first one's timestamp instead of overwriting it unseen.
   */
  findSettingsForUpdate(manager: EntityManager): Promise<HomeHero | null> {
    return this.query('h', manager).orderBy('h.createdAt', 'ASC').setLock('pessimistic_write').getOne();
  }

  /*
   * `activeOnly` is what separates the public read from the admin read: the admin edits hidden
   * slides, the website never sees them.
   */
  findSlides(heroId: string, opts: { activeOnly?: boolean; manager?: EntityManager } = {}): Promise<HomeHeroSlide[]> {
    const qb = (opts.manager ?? this.repo().manager)
      .getRepository(HomeHeroSlide)
      .createQueryBuilder('s')
      .where('s.isDelete = false')
      .andWhere('s.heroId = :heroId', { heroId })
      .orderBy('s.displayOrder', 'ASC')
      .addOrderBy('s.createdAt', 'ASC');
    if (opts.activeOnly) qb.andWhere('s.isActive = true');
    return qb.getMany();
  }

  slides(manager?: EntityManager) {
    return (manager ?? this.repo().manager).getRepository(HomeHeroSlide);
  }
}

export const heroRepository = new HeroRepository();
