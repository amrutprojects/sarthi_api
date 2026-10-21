import type { EntityManager } from 'typeorm';
import { Brackets } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../shared/utils/pagination';
import { EligibilityItem, type EligibilityItemKind, EligibilityPageSettings } from './eligibility.model';
import type { EligibilityListQuery, EligibilitySortField } from './eligibility.types';

/*
 * The page text is a singleton, so this repository has no list or paging: the only read that
 * matters is "the one live configuration".
 */
export class EligibilitySettingsRepository extends BaseRepository<EligibilityPageSettings> {
  constructor() {
    super(EligibilityPageSettings);
  }

  /* The live configuration, or null before the migration has run. */
  findSettings(manager?: EntityManager): Promise<EligibilityPageSettings | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').getOne();
  }
}

/*
 * After the chosen sort, rows always fall back to the order the website shows them in: criteria
 * before documents, then display order, then age. The chosen column is left out of the fallback —
 * TypeORM keys ORDER BY entries by column, so adding it again would overwrite its direction.
 */
const TIE_BREAKERS: EligibilitySortField[] = ['kind', 'displayOrder', 'createdAt'];

export class EligibilityItemRepository extends BaseRepository<EligibilityItem> {
  constructor() {
    super(EligibilityItem);
  }

  /*
   * Label lookup matching the unique indexes of the table ((kind, lower(label)) per language), so the
   * service can answer with a readable 409 instead of letting the constraint raise one. The same words
   * may appear once as a criterion and once as a document. excludeId skips the row being updated.
   */
  findByLabel(
    kind: EligibilityItemKind,
    lang: 'Mr' | 'En',
    text: string,
    opts: { excludeId?: string; manager?: EntityManager } = {},
  ): Promise<EligibilityItem | null> {
    const qb = this.query('i', opts.manager)
      .andWhere('i.kind = :kind', { kind })
      .andWhere(`lower(i.label${lang}) = lower(:text)`, { text });
    if (opts.excludeId) qb.andWhere('i.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  async list(q: EligibilityListQuery): Promise<Paginated<EligibilityItem>> {
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

  /* What the website lists: active criteria and documents, in display order. */
  findPublished(): Promise<EligibilityItem[]> {
    return this.findMany({ isActive: true }, { order: { displayOrder: 'ASC', createdAt: 'ASC' } });
  }

  /* The order a row gets when none is given: after every live row of the same kind. */
  async nextDisplayOrder(kind: EligibilityItemKind, manager?: EntityManager): Promise<number> {
    const row = await this.query('i', manager)
      .andWhere('i.kind = :kind', { kind })
      .select('MAX(i.displayOrder)', 'max')
      .getRawOne<{ max: number | null }>();
    return row?.max == null ? 1 : Number(row.max) + 1;
  }
}

export const eligibilitySettingsRepository = new EligibilitySettingsRepository();
export const eligibilityItemRepository = new EligibilityItemRepository();
