import { Brackets, type EntityManager } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../shared/utils/pagination';
import { LmsFormField } from './form-field.model';
import type { LmsFormFieldListQuery, LmsFormFieldSortField } from './form-field.types';

/* sortBy to SQL expressions; only these are sortable. position = form, section, order within the section. */
const SORT_SQL: Record<LmsFormFieldSortField, string[]> = {
  position: ['f.formCode', 'f.sectionCode', 'f.sortOrder'],
  label: ['f.label'],
  fieldCode: ['f.fieldCode'],
  createdAt: ['f.createdAt'],
  updatedAt: ['f.updatedAt'],
};

export class LmsFormFieldRepository extends BaseRepository<LmsFormField> {
  constructor() {
    super(LmsFormField);
  }

  /* Matches UQ_lms_form_fields_field_active (non-deleted rows). */
  findByFieldCode(formCode: string, fieldCode: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<LmsFormField | null> {
    const qb = this.query('f', opts.manager).andWhere('f.formCode = :formCode', { formCode }).andWhere('f.fieldCode = :fieldCode', { fieldCode });
    if (opts.excludeId) qb.andWhere('f.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  /* Matches UQ_lms_form_fields_label_active (case-insensitive, non-deleted rows). */
  findByLabel(formCode: string, label: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<LmsFormField | null> {
    const qb = this.query('f', opts.manager).andWhere('f.formCode = :formCode', { formCode }).andWhere('lower(f.label) = lower(:label)', { label });
    if (opts.excludeId) qb.andWhere('f.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  /*
   * F-LMS-FFC-03 label per language: a non-deleted field of the form that shows `label` in `lang` — its
   * translation for that language, else its base label (case-insensitive). Checked by the service: the
   * translations are jsonb and the language list is still open (OQ-023), so no index backs it.
   */
  findByLanguageLabel(formCode: string, lang: string, label: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<LmsFormField | null> {
    const qb = this.query('f', opts.manager)
      .andWhere('f.formCode = :formCode', { formCode })
      .andWhere(`lower(coalesce((f.translations -> CAST(:lang AS text)) ->> 'label', f.label)) = lower(:label)`, { lang, label });
    if (opts.excludeId) qb.andWhere('f.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  /* deleted = true: only the soft-deleted rows (restore candidates); otherwise the non-deleted ones. Same filters either way. */
  async list(q: LmsFormFieldListQuery): Promise<Paginated<LmsFormField>> {
    const qb = q.deleted ? this.repo().createQueryBuilder('f').where('f.isDelete = true') : this.query('f');
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(new Brackets((w) => w.where('f.label ILIKE :term', { term }).orWhere('f.fieldCode ILIKE :term', { term })));
    }
    if (q.formCode) qb.andWhere('f.formCode = :formCode', { formCode: q.formCode });
    if (q.sectionCode) qb.andWhere('f.sectionCode = :sectionCode', { sectionCode: q.sectionCode });
    if (q.isActive !== undefined) qb.andWhere('f.isActive = :isActive', { isActive: q.isActive });
    if (q.isRequired !== undefined) qb.andWhere('f.isRequired = :isRequired', { isRequired: q.isRequired });
    if (q.isVisible !== undefined) qb.andWhere('f.isVisible = :isVisible', { isVisible: q.isVisible });
    if (q.isCustom !== undefined) qb.andWhere('f.isCustom = :isCustom', { isCustom: q.isCustom });
    const [first, ...rest] = SORT_SQL[q.sortBy];
    qb.orderBy(first, q.sortOrder);
    for (const col of rest) qb.addOrderBy(col, q.sortOrder);
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.addOrderBy('f.id').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /* Active (not archived), visible fields of one form, by section then order. */
  findEffective(formCode: string): Promise<LmsFormField[]> {
    return this.findMany({ formCode, isActive: true, isVisible: true }, { order: { sectionCode: 'ASC', sortOrder: 'ASC', label: 'ASC' } });
  }

  /* Non-deleted fields per section of one form, hidden and archived ones included. */
  async countBySection(formCode: string): Promise<Map<string, number>> {
    const rows: { sectionCode: string; count: string }[] = await this.query('f')
      .select('f.sectionCode', 'sectionCode')
      .addSelect('COUNT(*)', 'count')
      .andWhere('f.formCode = :formCode', { formCode })
      .groupBy('f.sectionCode')
      .getRawMany();
    return new Map(rows.map((r) => [r.sectionCode, Number(r.count)]));
  }

  /* The next free position at the end of a section (sortOrder left out on create). */
  async nextSortOrder(formCode: string, sectionCode: string, m: EntityManager): Promise<number> {
    const row: { max: number | null } | undefined = await this.query('f', m)
      .select('MAX(f.sortOrder)', 'max')
      .andWhere('f.formCode = :formCode', { formCode })
      .andWhere('f.sectionCode = :sectionCode', { sectionCode })
      .getRawOne();
    return row?.max == null ? 1 : Number(row.max) + 1;
  }
}

export const lmsFormFieldRepository = new LmsFormFieldRepository();
