import type { EntityManager } from 'typeorm';
import { Brackets } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../shared/utils/pagination';
import {
  ContactCoordinator,
  ContactCoordinatorDistrict,
  ContactDistrictOffice,
  ContactOrganization,
  ContactPageSettings,
  ContactTrainingCentre,
} from './contact.model';
import type {
  CoordinatorListQuery,
  DistrictOfficeListQuery,
  DistrictOfficeSortField,
  TrainingCentreListQuery,
  TrainingCentreSortField,
} from './contact.types';

/*
 * ?sortBy= of the district office list, as columns of the query below (`district` is the district's name,
 * `collectorName` the District Coordinator's English name).
 */
const OFFICE_SORT: Record<DistrictOfficeSortField, string> = {
  district: 'd.name',
  collectorName: 'o.collectorNameEn',
  createdAt: 'o.createdAt',
  updatedAt: 'o.updatedAt',
};

/* ?sortBy= of the training centre list (`district` is the district's name). */
const CENTRE_SORT: Record<TrainingCentreSortField, string> = {
  district: 'd.name',
  displayOrder: 't.displayOrder',
  name: 't.nameEn',
  createdAt: 't.createdAt',
  updatedAt: 't.updatedAt',
};

/*
 * The Contact page configuration is a singleton, so the page itself has no list or paging: the read
 * that matters is "the one live configuration, with its cards". The coordinator and district office
 * sections are the exception — each is also listed and edited one entry at a time.
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

  /* Live coordinators of a configuration with the districts they cover (deleted districts are left out). */
  private coordinatorsWithDistricts(settingsId: string, opts: { activeOnly?: boolean; manager?: EntityManager } = {}) {
    return (opts.manager ?? this.repo().manager)
      .getRepository(ContactCoordinator)
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.districts', 'cd')
      .leftJoinAndSelect('cd.district', 'd', opts.activeOnly ? 'd.isDelete = false AND d.isActive = true' : 'd.isDelete = false')
      .where('c.isDelete = false')
      .andWhere('c.settingsId = :settingsId', { settingsId });
  }

  /* Coordinators with the districts they cover, in their saved order (deleted districts are left out). */
  findCoordinators(settingsId: string, opts: { activeOnly?: boolean; manager?: EntityManager } = {}): Promise<ContactCoordinator[]> {
    const qb = this.coordinatorsWithDistricts(settingsId, opts)
      .orderBy('c.displayOrder', 'ASC')
      .addOrderBy('c.createdAt', 'ASC')
      .addOrderBy('cd.displayOrder', 'ASC')
      .addOrderBy('d.name', 'ASC');
    if (opts.activeOnly) qb.andWhere('c.isActive = true');
    return qb.getMany();
  }

  /* One live coordinator, with its districts in their saved order. */
  findCoordinator(settingsId: string, id: string, manager?: EntityManager): Promise<ContactCoordinator | null> {
    return this.coordinatorsWithDistricts(settingsId, { manager })
      .andWhere('c.id = :id', { id })
      .orderBy('cd.displayOrder', 'ASC')
      .addOrderBy('d.name', 'ASC')
      .getOne();
  }

  /*
   * One page of coordinators. The page is cut without the district join — a joined page would count
   * district rows, not coordinators — and the districts are then loaded for that page only. Search
   * also matches the name of a covered district, so "Pune" finds Pune's coordinator.
   */
  async listCoordinators(settingsId: string, q: CoordinatorListQuery): Promise<Paginated<ContactCoordinator>> {
    const qb = this.coordinators()
      .createQueryBuilder('c')
      .where('c.isDelete = false')
      .andWhere('c.settingsId = :settingsId', { settingsId });
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('c.name ILIKE :term', { term })
            .orWhere('c.phone ILIKE :term', { term })
            .orWhere('c.email ILIKE :term', { term })
            .orWhere(
              `EXISTS (SELECT 1 FROM "contact_coordinator_districts" "scd" INNER JOIN "districts" "sd" ON "sd"."id" = "scd"."districtId" ` +
                `WHERE "scd"."coordinatorId" = "c"."id" AND "sd"."isDelete" = false AND "sd"."name" ILIKE :term)`,
              { term },
            ),
        ),
      );
    }
    if (q.isActive !== undefined) qb.andWhere('c.isActive = :isActive', { isActive: q.isActive });
    const { skip, take } = toSkipTake(q);
    qb.orderBy(`c.${q.sortBy}`, q.sortOrder);
    /* TypeORM keys ORDER BY entries by column, so re-adding the chosen column would overwrite its direction. */
    if (q.sortBy !== 'createdAt') qb.addOrderBy('c.createdAt', 'ASC');
    const [page, total] = await qb.addOrderBy('c.id').skip(skip).take(take).getManyAndCount();

    const ids = page.map((c) => c.id);
    const loaded = ids.length
      ? await this.coordinatorsWithDistricts(settingsId)
          .andWhere('c.id IN (:...ids)', { ids })
          .orderBy('cd.displayOrder', 'ASC')
          .addOrderBy('d.name', 'ASC')
          .getMany()
      : [];
    const byId = new Map(loaded.map((c) => [c.id, c]));
    return { items: page.map((c) => byId.get(c.id) ?? c), meta: buildMeta(q, total) };
  }

  /* The order a coordinator gets when none is given: after every live card. */
  async nextCoordinatorOrder(settingsId: string, manager?: EntityManager): Promise<number> {
    const row = await this.coordinators(manager)
      .createQueryBuilder('c')
      .select('MAX(c.displayOrder)', 'max')
      .where('c.isDelete = false')
      .andWhere('c.settingsId = :settingsId', { settingsId })
      .getRawOne<{ max: number | null }>();
    /* Capped at the validator's 999, or the new card could never be saved again from the Edit form. */
    return row?.max == null ? 0 : Math.min(Number(row.max) + 1, 999);
  }

  /* Live office rows of a configuration with their district (offices of a deleted district are left out). */
  private officesWithDistrict(settingsId: string, opts: { activeOnly?: boolean; manager?: EntityManager } = {}) {
    return (opts.manager ?? this.repo().manager)
      .getRepository(ContactDistrictOffice)
      .createQueryBuilder('o')
      .innerJoinAndSelect('o.district', 'd', opts.activeOnly ? 'd.isDelete = false AND d.isActive = true' : 'd.isDelete = false')
      .where('o.isDelete = false')
      .andWhere('o.settingsId = :settingsId', { settingsId });
  }

  /* District office rows, in district-name order. */
  findDistrictOffices(settingsId: string, opts: { activeOnly?: boolean; manager?: EntityManager } = {}): Promise<ContactDistrictOffice[]> {
    const qb = this.officesWithDistrict(settingsId, opts).orderBy('d.name', 'ASC');
    if (opts.activeOnly) qb.andWhere('o.isActive = true');
    return qb.getMany();
  }

  findDistrictOffice(settingsId: string, id: string, manager?: EntityManager): Promise<ContactDistrictOffice | null> {
    return this.officesWithDistrict(settingsId, { manager }).andWhere('o.id = :id', { id }).getOne();
  }

  /* One page of office rows. The join is many-to-one (one district per row), so it is safe to page. */
  async listDistrictOffices(settingsId: string, q: DistrictOfficeListQuery): Promise<Paginated<ContactDistrictOffice>> {
    const qb = this.officesWithDistrict(settingsId);
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('d.name ILIKE :term', { term })
            .orWhere('d.code ILIKE :term', { term })
            .orWhere('o.collectorNameEn ILIKE :term', { term })
            .orWhere('o.collectorNameMr ILIKE :term', { term })
            .orWhere('o.phone ILIKE :term', { term })
            .orWhere('o.email ILIKE :term', { term }),
        ),
      );
    }
    if (q.isActive !== undefined) qb.andWhere('o.isActive = :isActive', { isActive: q.isActive });
    const { skip, take } = toSkipTake(q);
    qb.orderBy(OFFICE_SORT[q.sortBy], q.sortOrder);
    if (q.sortBy !== 'createdAt') qb.addOrderBy('o.createdAt', 'ASC');
    const [items, total] = await qb.addOrderBy('o.id').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /*
   * The live office of a district, in any configuration — the scope of
   * UQ_contact_district_offices_district_active. excludeId skips the row being updated.
   */
  findOfficeOfDistrict(
    districtId: string,
    opts: { excludeId?: string; manager?: EntityManager } = {},
  ): Promise<ContactDistrictOffice | null> {
    const qb = (opts.manager ?? this.repo().manager)
      .getRepository(ContactDistrictOffice)
      .createQueryBuilder('o')
      .innerJoinAndSelect('o.district', 'd')
      .where('o.isDelete = false')
      .andWhere('o.districtId = :districtId', { districtId });
    if (opts.excludeId) qb.andWhere('o.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  /*
   * The links that already give any of these districts to a live coordinator other than excludeId — the
   * clashes UQ_contact_coordinator_districts_district would raise — with the district and coordinator
   * loaded so the refusal can name both.
   */
  findCoveredDistricts(
    districtIds: string[],
    opts: { excludeId?: string; manager?: EntityManager } = {},
  ): Promise<ContactCoordinatorDistrict[]> {
    const qb = (opts.manager ?? this.repo().manager)
      .getRepository(ContactCoordinatorDistrict)
      .createQueryBuilder('cd')
      .innerJoinAndSelect('cd.coordinator', 'c', 'c.isDelete = false')
      .innerJoinAndSelect('cd.district', 'd')
      .where('cd.districtId IN (:...districtIds)', { districtIds })
      .orderBy('d.name', 'ASC');
    if (opts.excludeId) qb.andWhere('cd.coordinatorId <> :excludeId', { excludeId: opts.excludeId });
    return qb.getMany();
  }

  coordinators(manager?: EntityManager) {
    return (manager ?? this.repo().manager).getRepository(ContactCoordinator);
  }

  /* ---------------- approved training centres ---------------- */

  /* Live centre rows of a configuration with their district (centres of a deleted district are left out). */
  private centresWithDistrict(settingsId: string, opts: { activeOnly?: boolean; manager?: EntityManager } = {}) {
    const qb = (opts.manager ?? this.repo().manager)
      .getRepository(ContactTrainingCentre)
      .createQueryBuilder('t')
      .innerJoinAndSelect('t.district', 'd', opts.activeOnly ? 'd.isDelete = false AND d.isActive = true' : 'd.isDelete = false')
      .where('t.isDelete = false')
      .andWhere('t.settingsId = :settingsId', { settingsId });
    if (opts.activeOnly) qb.andWhere('t.isActive = true');
    return qb;
  }

  /* Every centre, by district name and then each district's own order. */
  findTrainingCentres(settingsId: string, opts: { activeOnly?: boolean; manager?: EntityManager } = {}): Promise<ContactTrainingCentre[]> {
    return this.centresWithDistrict(settingsId, opts)
      .orderBy('d.name', 'ASC')
      .addOrderBy('t.displayOrder', 'ASC')
      .addOrderBy('t.createdAt', 'ASC')
      .getMany();
  }

  findTrainingCentre(settingsId: string, id: string, manager?: EntityManager): Promise<ContactTrainingCentre | null> {
    return this.centresWithDistrict(settingsId, { manager }).andWhere('t.id = :id', { id }).getOne();
  }

  async listTrainingCentres(settingsId: string, q: TrainingCentreListQuery): Promise<Paginated<ContactTrainingCentre>> {
    const qb = this.centresWithDistrict(settingsId);
    if (q.districtId) qb.andWhere('t.districtId = :districtId', { districtId: q.districtId });
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('d.name ILIKE :term', { term })
            .orWhere('d.code ILIKE :term', { term })
            .orWhere('t.nameEn ILIKE :term', { term })
            .orWhere('t.nameMr ILIKE :term', { term })
            .orWhere('t.managerNameEn ILIKE :term', { term })
            .orWhere('t.phone ILIKE :term', { term })
            .orWhere('t.email ILIKE :term', { term }),
        ),
      );
    }
    if (q.isActive !== undefined) qb.andWhere('t.isActive = :isActive', { isActive: q.isActive });
    const { skip, take } = toSkipTake(q);
    qb.orderBy(CENTRE_SORT[q.sortBy], q.sortOrder);
    if (q.sortBy === 'district') qb.addOrderBy('t.displayOrder', 'ASC');
    if (q.sortBy !== 'createdAt') qb.addOrderBy('t.createdAt', 'ASC');
    const [items, total] = await qb.addOrderBy('t.id').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /* The next free place at the end of a district's centres, capped at the validator's 999. */
  async nextTrainingCentreOrder(districtId: string, manager?: EntityManager): Promise<number> {
    const row = await (manager ?? this.repo().manager)
      .getRepository(ContactTrainingCentre)
      .createQueryBuilder('t')
      .select('MAX(t.displayOrder)', 'max')
      .where('t.isDelete = false')
      .andWhere('t.districtId = :districtId', { districtId })
      .getRawOne<{ max: number | null }>();
    return row?.max == null ? 0 : Math.min(Number(row.max) + 1, 999);
  }

  organizations(manager?: EntityManager) {
    return (manager ?? this.repo().manager).getRepository(ContactOrganization);
  }
}

export const contactRepository = new ContactRepository();
