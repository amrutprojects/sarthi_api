import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import { BoardMember, BoardSection } from './board.model';

/*
 * The members of the Leadership & Governing Board section. A short list (a handful of cards), so
 * reads return it whole, in display order — there is no paging.
 */
export class BoardMemberRepository extends BaseRepository<BoardMember> {
  constructor() {
    super(BoardMember);
  }

  /* `activeOnly` separates the website's read from the admin's: hidden members are edited, never shown. */
  list(opts: { activeOnly?: boolean; manager?: EntityManager } = {}): Promise<BoardMember[]> {
    const qb = this.query('m', opts.manager).orderBy('m.displayOrder', 'ASC').addOrderBy('m.createdAt', 'ASC');
    if (opts.activeOnly) qb.andWhere('m.isActive = true');
    return qb.getMany();
  }

  /*
   * One member, locked for the rest of the caller's transaction, so two saves of the same member are
   * serialised: the second sees the first one's photo key and timestamp instead of overwriting unseen.
   */
  findForUpdate(id: string, manager: EntityManager): Promise<BoardMember | null> {
    return this.query('m', manager).andWhere('m.id = :id', { id }).setLock('pessimistic_write').getOne();
  }

  /* Every member, locked: a reorder rewrites them all. */
  lockAll(manager: EntityManager): Promise<BoardMember[]> {
    return this.query('m', manager).setLock('pessimistic_write').getMany();
  }

  /* The member a stored photo belongs to; the photo routes serve nothing that no member references. */
  findByPhotoKey(photoKey: string, opts: { activeOnly?: boolean } = {}): Promise<BoardMember | null> {
    const qb = this.query('m').andWhere('m.photoKey = :photoKey', { photoKey });
    if (opts.activeOnly) qb.andWhere('m.isActive = true');
    return qb.getOne();
  }

  /* The same person already listed for the same office (English, case-insensitive), other than `exceptId`. */
  findDuplicate(nameEn: string, designationEn: string, exceptId?: string, manager?: EntityManager): Promise<BoardMember | null> {
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
}

/* The section's settings: a singleton, so the only read that matters is "the one live row". */
export class BoardSectionRepository extends BaseRepository<BoardSection> {
  constructor() {
    super(BoardSection);
  }

  find(manager?: EntityManager): Promise<BoardSection | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').getOne();
  }

  findForUpdate(manager: EntityManager): Promise<BoardSection | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').setLock('pessimistic_write').getOne();
  }
}

export const boardMemberRepository = new BoardMemberRepository();
export const boardSectionRepository = new BoardSectionRepository();
