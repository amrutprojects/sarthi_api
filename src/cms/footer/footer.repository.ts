import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import { FooterLink, FooterSection, FooterSettings } from './footer.model';

/*
 * The footer configuration is a singleton, so this repository has no list or paging: the only read
 * that matters is "the one live configuration, with its columns and their links".
 */
export class FooterRepository extends BaseRepository<FooterSettings> {
  constructor() {
    super(FooterSettings);
  }

  /* The live configuration, or null before the seed has run. */
  findSettings(manager?: EntityManager): Promise<FooterSettings | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').getOne();
  }

  /*
   * The columns of a configuration, in the order the footer shows them.
   * `activeOnly` is what separates the public read from the admin read: the admin edits inactive
   * columns, the website never sees them.
   */
  findSections(
    settingsId: string,
    opts: { activeOnly?: boolean; manager?: EntityManager } = {},
  ): Promise<FooterSection[]> {
    const qb = (opts.manager ?? this.repo().manager)
      .getRepository(FooterSection)
      .createQueryBuilder('s')
      .where('s.isDelete = false')
      .andWhere('s.settingsId = :settingsId', { settingsId })
      .orderBy('s.displayOrder', 'ASC')
      .addOrderBy('s.createdAt', 'ASC');
    if (opts.activeOnly) qb.andWhere('s.isActive = true');
    return qb.getMany();
  }

  /* Every link belonging to the given columns, ordered as they are rendered. */
  findLinks(
    sectionIds: string[],
    opts: { activeOnly?: boolean; manager?: EntityManager } = {},
  ): Promise<FooterLink[]> {
    if (sectionIds.length === 0) return Promise.resolve([]);
    const qb = (opts.manager ?? this.repo().manager)
      .getRepository(FooterLink)
      .createQueryBuilder('l')
      .where('l.isDelete = false')
      .andWhere('l.sectionId IN (:...sectionIds)', { sectionIds })
      .orderBy('l.displayOrder', 'ASC')
      .addOrderBy('l.createdAt', 'ASC');
    if (opts.activeOnly) qb.andWhere('l.isActive = true');
    return qb.getMany();
  }

  sections(manager?: EntityManager) {
    return (manager ?? this.repo().manager).getRepository(FooterSection);
  }

  links(manager?: EntityManager) {
    return (manager ?? this.repo().manager).getRepository(FooterLink);
  }
}

export const footerRepository = new FooterRepository();
