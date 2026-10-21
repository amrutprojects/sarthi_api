import type { EntityManager } from 'typeorm';
import { Brackets } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../shared/utils/pagination';
import { Faq } from './faq.model';
import type { FaqListQuery } from './faq.types';

export class FaqRepository extends BaseRepository<Faq> {
  constructor() {
    super(Faq);
  }

  /*
   * Question lookup matching the unique indexes of the table (lower(question) per language), so the
   * service can answer with a readable 409 instead of letting the constraint raise one. excludeId skips
   * the row being updated.
   */
  findByQuestion(lang: 'Mr' | 'En', text: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<Faq | null> {
    const qb = this.query('f', opts.manager).andWhere(`lower(f.question${lang}) = lower(:text)`, { text });
    if (opts.excludeId) qb.andWhere('f.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  async list(q: FaqListQuery): Promise<Paginated<Faq>> {
    const qb = this.query('f');
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('f.questionEn ILIKE :term', { term })
            .orWhere('f.questionMr ILIKE :term', { term })
            .orWhere('f.answerEn ILIKE :term', { term })
            .orWhere('f.answerMr ILIKE :term', { term }),
        ),
      );
    }
    if (q.isActive !== undefined) qb.andWhere('f.isActive = :isActive', { isActive: q.isActive });
    const { skip, take } = toSkipTake(q);
    qb.orderBy(`f.${q.sortBy}`, q.sortOrder);
    /* TypeORM keys ORDER BY entries by column, so re-adding the chosen column would overwrite its direction. */
    if (q.sortBy !== 'createdAt') qb.addOrderBy('f.createdAt', 'ASC');
    const [items, total] = await qb.addOrderBy('f.id').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /* What the website lists: active questions, in display order. */
  findPublished(): Promise<Faq[]> {
    return this.findMany({ isActive: true }, { order: { displayOrder: 'ASC', createdAt: 'ASC' } });
  }

  /* The order a question gets when none is given: after every live question. */
  async nextDisplayOrder(manager?: EntityManager): Promise<number> {
    const row = await this.query('f', manager).select('MAX(f.displayOrder)', 'max').getRawOne<{ max: number | null }>();
    return row?.max == null ? 1 : Number(row.max) + 1;
  }
}

export const faqRepository = new FaqRepository();
