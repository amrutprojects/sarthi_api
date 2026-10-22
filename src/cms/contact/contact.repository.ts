import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import { ContactCoordinator, ContactDistrictOffice, ContactOrganization, ContactPageSettings } from './contact.model';

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

  /* Coordinators with the districts they cover, in their saved order (deleted districts are left out). */
  findCoordinators(settingsId: string, opts: { activeOnly?: boolean; manager?: EntityManager } = {}): Promise<ContactCoordinator[]> {
    const qb = (opts.manager ?? this.repo().manager)
      .getRepository(ContactCoordinator)
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.districts', 'cd')
      .leftJoinAndSelect('cd.district', 'd', opts.activeOnly ? 'd.isDelete = false AND d.isActive = true' : 'd.isDelete = false')
      .where('c.isDelete = false')
      .andWhere('c.settingsId = :settingsId', { settingsId })
      .orderBy('c.displayOrder', 'ASC')
      .addOrderBy('c.createdAt', 'ASC')
      .addOrderBy('cd.displayOrder', 'ASC')
      .addOrderBy('d.name', 'ASC');
    if (opts.activeOnly) qb.andWhere('c.isActive = true');
    return qb.getMany();
  }

  /* District office rows, in district-name order. */
  findDistrictOffices(settingsId: string, opts: { activeOnly?: boolean; manager?: EntityManager } = {}): Promise<ContactDistrictOffice[]> {
    const qb = (opts.manager ?? this.repo().manager)
      .getRepository(ContactDistrictOffice)
      .createQueryBuilder('o')
      .innerJoinAndSelect('o.district', 'd', opts.activeOnly ? 'd.isDelete = false AND d.isActive = true' : 'd.isDelete = false')
      .where('o.isDelete = false')
      .andWhere('o.settingsId = :settingsId', { settingsId })
      .orderBy('d.name', 'ASC');
    if (opts.activeOnly) qb.andWhere('o.isActive = true');
    return qb.getMany();
  }

  organizations(manager?: EntityManager) {
    return (manager ?? this.repo().manager).getRepository(ContactOrganization);
  }
}

export const contactRepository = new ContactRepository();
