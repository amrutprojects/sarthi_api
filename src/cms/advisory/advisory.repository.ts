import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import { AdvisoryGroup, AdvisoryMember, AdvisorySection } from './advisory.model';

/*
 * The members of the Advisory Committee. A short list (tens of cards at most), so reads return it
 * whole, in display order — there is no paging.
 */
export class AdvisoryMemberRepository extends BaseRepository<AdvisoryMember> {
  constructor() {
    super(AdvisoryMember);
  }

  /* `activeOnly` separates the website's read from the admin's: hidden members are edited, never shown. */
  list(opts: { activeOnly?: boolean; manager?: EntityManager } = {}): Promise<AdvisoryMember[]> {
    const qb = this.query('m', opts.manager).orderBy('m.displayOrder', 'ASC').addOrderBy('m.createdAt', 'ASC');
    if (opts.activeOnly) qb.andWhere('m.isActive = true');
    return qb.getMany();
  }

  /*
   * One member, locked for the rest of the caller's transaction, so two saves of the same member are
   * serialised: the second sees the first one's photo key and timestamp instead of overwriting unseen.
   */
  findForUpdate(id: string, manager: EntityManager): Promise<AdvisoryMember | null> {
    return this.query('m', manager).andWhere('m.id = :id', { id }).setLock('pessimistic_write').getOne();
  }

  /* Every member, locked: a reorder rewrites them all. */
  lockAll(manager: EntityManager): Promise<AdvisoryMember[]> {
    return this.query('m', manager).setLock('pessimistic_write').getMany();
  }

  /* The member a stored photo belongs to; the photo routes serve nothing that no member references. */
  findByPhotoKey(photoKey: string, opts: { activeOnly?: boolean } = {}): Promise<AdvisoryMember | null> {
    const qb = this.query('m').andWhere('m.photoKey = :photoKey', { photoKey });
    if (opts.activeOnly) qb.andWhere('m.isActive = true');
    return qb.getOne();
  }

  /*
   * The same person already listed in the same position (English, case-insensitive; a blank
   * position matches a blank one), other than `exceptId`. Mirrors the partial unique index.
   */
  findDuplicate(nameEn: string, designationEn: string, exceptId?: string, manager?: EntityManager): Promise<AdvisoryMember | null> {
    const qb = this.query('m', manager)
      .andWhere('lower(m.nameEn) = lower(:nameEn)', { nameEn })
      .andWhere('lower(m.designationEn) = lower(:designationEn)', { designationEn });
    if (exceptId) qb.andWhere('m.id <> :exceptId', { exceptId });
    return qb.getOne();
  }

  async maxOrder(manager?: EntityManager): Promise<number> {
    const row = await this.query('m', manager).select('COALESCE(MAX(m.displayOrder), 0)', 'max').getRawOne<{ max: number | string }>();
    return Number(row?.max ?? 0);
  }

  /* How many members each group holds (hidden members included), by group id; groups with none are absent. */
  async countByGroup(): Promise<Map<string, number>> {
    const rows = await this.query('m')
      .select('m.groupId', 'groupId')
      .addSelect('COUNT(*)', 'n')
      .andWhere('m.groupId IS NOT NULL')
      .groupBy('m.groupId')
      .getRawMany<{ groupId: string; n: number | string }>();
    return new Map(rows.map((r) => [r.groupId, Number(r.n)]));
  }

  /* Files every member of a group under no group; returns how many there were. */
  ungroup(groupId: string, manager: EntityManager): Promise<number> {
    return this.updateWhere({ groupId }, { groupId: null }, manager);
  }
}

/* The headings members are listed under. A handful at most, so reads return them all, in display order. */
export class AdvisoryGroupRepository extends BaseRepository<AdvisoryGroup> {
  constructor() {
    super(AdvisoryGroup);
  }

  /* Hidden groups included: the admin edits them, and the website needs them to leave their members out. */
  list(manager?: EntityManager): Promise<AdvisoryGroup[]> {
    return this.query('g', manager).orderBy('g.displayOrder', 'ASC').addOrderBy('g.createdAt', 'ASC').getMany();
  }

  findForUpdate(id: string, manager: EntityManager): Promise<AdvisoryGroup | null> {
    return this.query('g', manager).andWhere('g.id = :id', { id }).setLock('pessimistic_write').getOne();
  }

  /*
   * The group a member is being filed under, share-locked for the rest of the member's transaction: a
   * concurrent delete of the group (which takes the row lock) then waits for the member to be saved and
   * ungroups it too, or has already committed and this finds nothing — never a member left in a
   * deleted group.
   */
  findForShare(id: string, manager: EntityManager): Promise<AdvisoryGroup | null> {
    return this.query('g', manager).andWhere('g.id = :id', { id }).setLock('pessimistic_read').getOne();
  }

  /* Every group, locked: a reorder rewrites them all. */
  lockAll(manager: EntityManager): Promise<AdvisoryGroup[]> {
    return this.query('g', manager).setLock('pessimistic_write').getMany();
  }

  /* A live group with this English name (case-insensitive), other than `exceptId`. Mirrors the partial unique index. */
  findDuplicate(nameEn: string, exceptId?: string, manager?: EntityManager): Promise<AdvisoryGroup | null> {
    const qb = this.query('g', manager).andWhere('lower(g.nameEn) = lower(:nameEn)', { nameEn });
    if (exceptId) qb.andWhere('g.id <> :exceptId', { exceptId });
    return qb.getOne();
  }

  async maxOrder(manager?: EntityManager): Promise<number> {
    const row = await this.query('g', manager).select('COALESCE(MAX(g.displayOrder), 0)', 'max').getRawOne<{ max: number | string }>();
    return Number(row?.max ?? 0);
  }
}

/* The page's settings: a singleton, so the only read that matters is "the one live row". */
export class AdvisorySectionRepository extends BaseRepository<AdvisorySection> {
  constructor() {
    super(AdvisorySection);
  }

  find(manager?: EntityManager): Promise<AdvisorySection | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').getOne();
  }

  findForUpdate(manager: EntityManager): Promise<AdvisorySection | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').setLock('pessimistic_write').getOne();
  }
}

export const advisoryMemberRepository = new AdvisoryMemberRepository();
export const advisoryGroupRepository = new AdvisoryGroupRepository();
export const advisorySectionRepository = new AdvisorySectionRepository();
