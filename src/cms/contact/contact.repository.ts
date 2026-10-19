import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../repositories/base.repository';
import { ContactOrganization, ContactPageSettings } from './contact.model';

/*
 * The Contact page configuration is a singleton, so this repository has no list or paging: the only
 * read that matters is "the one live configuration, with its cards".
 */
export class ContactRepository extends BaseRepository<ContactPageSettings> {
  constructor() {
    super(ContactPageSettings);
  }

  /* The live configuration, or null before the seed has run. */
  findSettings(manager?: EntityManager): Promise<ContactPageSettings | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').getOne();
  }

  /*
   * The cards of a configuration, in the order the page shows them.
   * `activeOnly` is what separates the public read from the admin read: the admin edits inactive
   * cards, the website never sees them.
   */
  findOrganizations(settingsId: string, opts: { activeOnly?: boolean; manager?: EntityManager } = {}): Promise<ContactOrganization[]> {
    const qb = (opts.manager ?? this.repo().manager)
      .getRepository(ContactOrganization)
      .createQueryBuilder('o')
      .where('o.isDelete = false')
      .andWhere('o.settingsId = :settingsId', { settingsId })
      .orderBy('o.displayOrder', 'ASC')
      .addOrderBy('o.createdAt', 'ASC');
    if (opts.activeOnly) qb.andWhere('o.isActive = true');
    return qb.getMany();
  }

  organizations(manager?: EntityManager) {
    return (manager ?? this.repo().manager).getRepository(ContactOrganization);
  }
}

export const contactRepository = new ContactRepository();
