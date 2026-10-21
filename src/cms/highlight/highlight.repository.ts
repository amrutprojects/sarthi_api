import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import { ProgrammeHighlight, ProgrammeHighlightObjective } from './highlight.model';

/*
 * The programme section is a singleton, so this repository has no list or paging: the only read
 * that matters is "the one live configuration, with its objectives".
 */
export class HighlightRepository extends BaseRepository<ProgrammeHighlight> {
  constructor() {
    super(ProgrammeHighlight);
  }

  findSettings(manager?: EntityManager): Promise<ProgrammeHighlight | null> {
    return this.query('h', manager).orderBy('h.createdAt', 'ASC').getOne();
  }

  /*
   * `activeOnly` is what separates the public read from the admin read: the admin edits inactive
   * objectives, the website never sees them.
   */
  findObjectives(
    highlightId: string,
    opts: { activeOnly?: boolean; manager?: EntityManager } = {},
  ): Promise<ProgrammeHighlightObjective[]> {
    const qb = (opts.manager ?? this.repo().manager)
      .getRepository(ProgrammeHighlightObjective)
      .createQueryBuilder('o')
      .where('o.isDelete = false')
      .andWhere('o.highlightId = :highlightId', { highlightId })
      .orderBy('o.displayOrder', 'ASC')
      .addOrderBy('o.createdAt', 'ASC');
    if (opts.activeOnly) qb.andWhere('o.isActive = true');
    return qb.getMany();
  }

  objectives(manager?: EntityManager) {
    return (manager ?? this.repo().manager).getRepository(ProgrammeHighlightObjective);
  }
}

export const highlightRepository = new HighlightRepository();
