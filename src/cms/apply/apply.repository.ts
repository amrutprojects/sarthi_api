import type { EntityManager } from 'typeorm';
import { Brackets } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../shared/utils/pagination';
import { ApplyPageItem, type ApplyItemKind, ApplyPageSettings } from './apply.model';
import type { ApplyListQuery, ApplySortField } from './apply.types';

/*
 * The page text is a singleton, so this repository has no list or paging: the only read that
 * matters is "the one live configuration".
 */
export class ApplySettingsRepository extends BaseRepository<ApplyPageSettings> {
  constructor() {
    super(ApplyPageSettings);
  }

  /* The live configuration, or null before the migration has run. */
  findSettings(manager?: EntityManager): Promise<ApplyPageSettings | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').getOne();
  }
}

/*
 * After the chosen sort, rows always fall back to one list after the other, then display order,
 * then age. The chosen column is left out of the fallback — TypeORM keys ORDER BY entries by
 * column, so adding it again would overwrite its direction.
 */
const TIE_BREAKERS: ApplySortField[] = ['kind', 'displayOrder', 'createdAt'];

export class ApplyItemRepository extends BaseRepository<ApplyPageItem> {
  constructor() {
    super(ApplyPageItem);
  }

  /*
   * Label lookup matching the unique indexes of the table ((kind, lower(label)) per language), so the
   * service can answer with a readable 409 instead of letting the constraint raise one. The same words
   * may appear once as a step and once as an "At a glance" row. excludeId skips the row being updated.
   */
  findByLabel(
    kind: ApplyItemKind,
    lang: 'Mr' | 'En',
    text: string,
    opts: { excludeId?: string; manager?: EntityManager } = {},
  ): Promise<ApplyPageItem | null> {
    const qb = this.query('i', opts.manager)
      .andWhere('i.kind = :kind', { kind })
      .andWhere(`lower(i.label${lang}) = lower(:text)`, { text });
    if (opts.excludeId) qb.andWhere('i.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  async list(q: ApplyListQuery): Promise<Paginated<ApplyPageItem>> {
    const qb = this.query('i');
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('i.labelEn ILIKE :term', { term })
            .orWhere('i.labelMr ILIKE :term', { term })
            .orWhere('i.valueEn ILIKE :term', { term })
            .orWhere('i.valueMr ILIKE :term', { term }),
        ),
      );
    }
    if (q.kind) qb.andWhere('i.kind = :kind', { kind: q.kind });
    if (q.isActive !== undefined) qb.andWhere('i.isActive = :isActive', { isActive: q.isActive });
    qb.orderBy(`i.${q.sortBy}`, q.sortOrder);
    for (const column of TIE_BREAKERS) if (column !== q.sortBy) qb.addOrderBy(`i.${column}`, 'ASC');
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.addOrderBy('i.id').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /* What the website lists: active steps and "At a glance" rows, in display order. */
  findPublished(): Promise<ApplyPageItem[]> {
    return this.findMany({ isActive: true }, { order: { displayOrder: 'ASC', createdAt: 'ASC' } });
  }

  /* The order a row gets when none is given: after every live row of the same kind. */
  async nextDisplayOrder(kind: ApplyItemKind, manager?: EntityManager): Promise<number> {
    const row = await this.query('i', manager)
      .andWhere('i.kind = :kind', { kind })
      .select('MAX(i.displayOrder)', 'max')
      .getRawOne<{ max: number | null }>();
    /* Capped at the validator's 9999, or the new row could never be saved again from the Edit form. */
    return row?.max == null ? 1 : Math.min(Number(row.max) + 1, 9999);
  }
}

export const applySettingsRepository = new ApplySettingsRepository();
export const applyItemRepository = new ApplyItemRepository();
