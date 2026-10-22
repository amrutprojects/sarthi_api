import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../shared/utils/pagination';
import { LmsCourseModule } from './course-module.model';
import type { LmsCourseModuleListQuery, LmsCourseModuleSortField } from './course-module.types';

/* sortBy to SQL expression; only these columns are sortable. */
const SORT_SQL: Record<LmsCourseModuleSortField, string> = {
  moduleNumber: 'cm.moduleNumber',
  title: 'cm.title',
  createdAt: 'cm.createdAt',
  updatedAt: 'cm.updatedAt',
};

export class LmsCourseModuleRepository extends BaseRepository<LmsCourseModule> {
  constructor() {
    super(LmsCourseModule);
  }

  /* With its course (whatever its state). */
  findWithCourse(id: string, m?: EntityManager): Promise<LmsCourseModule | null> {
    return this.query('cm', m).leftJoinAndSelect('cm.course', 'c').andWhere('cm.id = :id', { id }).getOne();
  }

  /* Matches UQ_lms_course_modules_number_active (non-deleted rows). */
  findByNumber(courseId: string, moduleNumber: number, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<LmsCourseModule | null> {
    const qb = this.query('cm', opts.manager).andWhere('cm.courseId = :courseId', { courseId }).andWhere('cm.moduleNumber = :moduleNumber', { moduleNumber });
    if (opts.excludeId) qb.andWhere('cm.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  async list(q: LmsCourseModuleListQuery): Promise<Paginated<LmsCourseModule>> {
    /* deleted: ONLY the soft-deleted rows (the explicit "Show deleted" list); otherwise the non-deleted ones, as query() does. */
    const qb = this.repo()
      .createQueryBuilder('cm')
      .where('cm.isDelete = :isDelete', { isDelete: q.deleted === true })
      .leftJoinAndSelect('cm.course', 'c');
    if (q.search) qb.andWhere('cm.title ILIKE :term', { term: likePattern(q.search) });
    if (q.isActive !== undefined) qb.andWhere('cm.isActive = :isActive', { isActive: q.isActive });
    if (q.courseId) qb.andWhere('cm.courseId = :courseId', { courseId: q.courseId });
    if (q.moduleNumber !== undefined) qb.andWhere('cm.moduleNumber = :moduleNumber', { moduleNumber: q.moduleNumber });
    if (q.status) qb.andWhere('cm.status = :status', { status: q.status });
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb
      .orderBy(SORT_SQL[q.sortBy], q.sortOrder)
      .addOrderBy('c.code', 'ASC')
      .addOrderBy('cm.id')
      .skip(skip)
      .take(take)
      .getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /* Modules offered in a dropdown: not deleted, active and not RETIRED, by course then number. */
  findSelectable(filter: { courseId?: string; moduleNumber?: number }): Promise<LmsCourseModule[]> {
    const qb = this.query('cm').andWhere('cm.isActive = true').andWhere(`cm.status <> 'RETIRED'`);
    if (filter.courseId) qb.andWhere('cm.courseId = :courseId', { courseId: filter.courseId });
    if (filter.moduleNumber !== undefined) qb.andWhere('cm.moduleNumber = :moduleNumber', { moduleNumber: filter.moduleNumber });
    return qb.orderBy('cm.courseId').addOrderBy('cm.moduleNumber', 'ASC').getMany();
  }

  /* The non-deleted modules of one course, 1 to 4, with the course. */
  forCourse(courseId: string, m?: EntityManager): Promise<LmsCourseModule[]> {
    return this.query('cm', m).leftJoinAndSelect('cm.course', 'c').andWhere('cm.courseId = :courseId', { courseId }).orderBy('cm.moduleNumber', 'ASC').getMany();
  }
}

export const lmsCourseModuleRepository = new LmsCourseModuleRepository();
