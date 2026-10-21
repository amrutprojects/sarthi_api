import { Brackets, type EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { BaseRepository } from '../../database/base.repository';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../shared/utils/pagination';
import { LmsCourseModule } from '../course-module/course-module.model';
import { LmsCourse } from './course.model';
import type { LmsCourseListQuery, LmsCourseSortField } from './course.types';

/* sortBy to SQL expression; only these columns are sortable. */
const SORT_SQL: Record<LmsCourseSortField, string> = {
  code: 'c.code',
  title: 'c.title',
  status: 'c.status',
  createdAt: 'c.createdAt',
  updatedAt: 'c.updatedAt',
};

const manager = (m?: EntityManager) => m ?? AppDataSource.manager;

export class LmsCourseRepository extends BaseRepository<LmsCourse> {
  constructor() {
    super(LmsCourse);
  }

  /* With the owner entity (whatever its state) for the list and detail. */
  findWithEntity(id: string, m?: EntityManager): Promise<LmsCourse | null> {
    return this.query('c', m).leftJoinAndSelect('c.entity', 'e').andWhere('c.id = :id', { id }).getOne();
  }

  /* Matches UQ_lms_courses_code_active (non-deleted rows). */
  findByCode(code: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<LmsCourse | null> {
    const qb = this.query('c', opts.manager).andWhere('c.code = :code', { code });
    if (opts.excludeId) qb.andWhere('c.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  async list(q: LmsCourseListQuery): Promise<Paginated<LmsCourse>> {
    /* deleted: ONLY the soft-deleted rows (the explicit "Show deleted" list); otherwise the non-deleted ones, as query() does. */
    const qb = this.repo()
      .createQueryBuilder('c')
      .where('c.isDelete = :isDelete', { isDelete: q.deleted === true })
      .leftJoinAndSelect('c.entity', 'e');
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(new Brackets((w) => w.where('c.code ILIKE :term', { term }).orWhere('c.title ILIKE :term', { term })));
    }
    if (q.isActive !== undefined) qb.andWhere('c.isActive = :isActive', { isActive: q.isActive });
    if (q.status) qb.andWhere('c.status = :status', { status: q.status });
    if (q.entityId) qb.andWhere('c.entityId = :entityId', { entityId: q.entityId });
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.orderBy(SORT_SQL[q.sortBy], q.sortOrder).addOrderBy('c.id').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /* Courses offered in a dropdown: not deleted, active and not RETIRED, A to Z by title. */
  findSelectable(entityId?: string): Promise<LmsCourse[]> {
    const qb = this.query('c').andWhere('c.isActive = true').andWhere(`c.status <> 'RETIRED'`);
    if (entityId) qb.andWhere('c.entityId = :entityId', { entityId });
    return qb.orderBy('c.title', 'ASC').addOrderBy('c.code', 'ASC').getMany();
  }

  /* The non-deleted modules of one course, 1 to 4. */
  modules(courseId: string, m?: EntityManager): Promise<LmsCourseModule[]> {
    return manager(m).getRepository(LmsCourseModule).find({ where: { courseId, isDelete: false }, order: { moduleNumber: 'ASC' } });
  }
}

export const lmsCourseRepository = new LmsCourseRepository();
