import { Brackets, type EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { BaseRepository } from '../../database/base.repository';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../shared/utils/pagination';
import { completeSql, countsSelect, toCounts } from './track-variant.completeness';
import { LmsTrackVariant } from './track-variant.model';
import type {
  TrackVariantCounts, TrackVariantCourse, TrackVariantCourseModule, TrackVariantListQuery, TrackVariantSortField, TrackVariantTrack,
} from './track-variant.types';

/* sortBy to SQL expression; only these columns are sortable. */
const SORT_SQL: Record<TrackVariantSortField, string> = {
  track: 't.sortOrder',
  status: 'v.status',
  createdAt: 'v.createdAt',
  updatedAt: 'v.updatedAt',
};

const manager = (m?: EntityManager) => m ?? AppDataSource.manager;

/* The course, module and track a variant points at, read whatever their state. */
export interface VariantContext {
  course: TrackVariantCourse;
  courseModule: TrackVariantCourseModule;
  track: TrackVariantTrack;
}

export class LmsTrackVariantRepository extends BaseRepository<LmsTrackVariant> {
  constructor() {
    super(LmsTrackVariant);
  }

  /* Matches UQ_lms_track_variants_pair_active. */
  findByPair(courseModuleId: string, trackId: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<LmsTrackVariant | null> {
    const qb = this.query('v', opts.manager)
      .andWhere('v.courseModuleId = :courseModuleId', { courseModuleId })
      .andWhere('v.trackId = :trackId', { trackId });
    if (opts.excludeId) qb.andWhere('v.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  async list(q: TrackVariantListQuery): Promise<Paginated<LmsTrackVariant>> {
    /* deleted: ONLY the soft-deleted rows (the explicit "Show deleted" list); otherwise the non-deleted ones, as query() does. */
    const qb = this.repo()
      .createQueryBuilder('v')
      .where('v.isDelete = :isDelete', { isDelete: q.deleted === true })
      .innerJoin('v.track', 't')
      .innerJoin('v.courseModule', 'cm')
      .innerJoin('cm.course', 'c');
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('t.code ILIKE :term', { term })
            .orWhere('t.name ILIKE :term', { term })
            .orWhere('c.code ILIKE :term', { term })
            .orWhere('c.title ILIKE :term', { term }),
        ),
      );
    }
    if (q.isActive !== undefined) qb.andWhere('v.isActive = :isActive', { isActive: q.isActive });
    if (q.courseId) qb.andWhere('cm.courseId = :courseId', { courseId: q.courseId });
    if (q.courseModuleId) qb.andWhere('v.courseModuleId = :courseModuleId', { courseModuleId: q.courseModuleId });
    if (q.trackId) qb.andWhere('v.trackId = :trackId', { trackId: q.trackId });
    if (q.status) qb.andWhere('v.status = :status', { status: q.status });
    if (q.completeness) qb.andWhere(q.completeness === 'complete' ? completeSql('"v"') : `NOT ${completeSql('"v"')}`);
    const { skip, take } = toSkipTake(q);
    qb.orderBy(SORT_SQL[q.sortBy], q.sortOrder);
    /* Track order breaks ties (TypeORM keys ORDER BY by column, so never re-add the sort column itself). */
    if (q.sortBy !== 'track') qb.addOrderBy('t.sortOrder', 'ASC');
    const [items, total] = await qb
      .addOrderBy('v.id')
      /* Many-to-one inner joins only (one row per variant), so OFFSET / LIMIT page correctly. */
      .offset(skip)
      .limit(take)
      .getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /* Variants offered in a dropdown: active, not retired, in track order. */
  findSelectable(courseModuleId?: string): Promise<LmsTrackVariant[]> {
    const qb = this.query('v')
      .innerJoinAndSelect('v.track', 't')
      .andWhere('v.isActive = true')
      .andWhere(`v.status <> 'RETIRED'`);
    if (courseModuleId) qb.andWhere('v.courseModuleId = :courseModuleId', { courseModuleId });
    return qb.orderBy('t.sortOrder', 'ASC').addOrderBy('v.id').getMany();
  }

  /* Completeness counts of each variant (see track-variant.completeness.ts). */
  async counts(ids: string[], m?: EntityManager): Promise<Map<string, TrackVariantCounts>> {
    const out = new Map<string, TrackVariantCounts>();
    if (!ids.length) return out;
    const qb = manager(m).getRepository(LmsTrackVariant).createQueryBuilder('v').select('v.id', 'id');
    for (const [alias, sql] of countsSelect('"v"')) qb.addSelect(sql, alias);
    const rows: Record<string, unknown>[] = await qb.where('v.id IN (:...ids)', { ids }).getRawMany();
    for (const r of rows) out.set(r.id as string, toCounts(r));
    return out;
  }

  /* Course, module and track of each variant (deleted / inactive ones included, as they are now). */
  async contexts(variants: LmsTrackVariant[], m?: EntityManager): Promise<Map<string, VariantContext>> {
    const out = new Map<string, VariantContext>();
    if (!variants.length) return out;
    const rows: {
      id: string; courseId: string; courseCode: string; courseTitle: string; entityId: string;
      moduleId: string; moduleNumber: number; moduleTitle: string; coreHours: string | null; oftHoursMin: string | null; oftHoursMax: string | null;
      trackId: string; trackCode: string; trackName: string; trackUsable: boolean;
    }[] = await manager(m)
      .getRepository(LmsTrackVariant)
      .createQueryBuilder('v')
      .innerJoin('v.track', 't')
      .innerJoin('v.courseModule', 'cm')
      .innerJoin('cm.course', 'c')
      .select('v.id', 'id')
      .addSelect('c.id', 'courseId')
      .addSelect('c.code', 'courseCode')
      .addSelect('c.title', 'courseTitle')
      .addSelect('c.entityId', 'entityId')
      .addSelect('cm.id', 'moduleId')
      .addSelect('cm.moduleNumber', 'moduleNumber')
      .addSelect('cm.title', 'moduleTitle')
      .addSelect('cm.coreHours', 'coreHours')
      .addSelect('cm.oftHoursMin', 'oftHoursMin')
      .addSelect('cm.oftHoursMax', 'oftHoursMax')
      .addSelect('t.id', 'trackId')
      .addSelect('t.code', 'trackCode')
      .addSelect('t.name', 'trackName')
      .addSelect('(t.isActive AND NOT t.isDelete)', 'trackUsable')
      .where('v.id IN (:...ids)', { ids: variants.map((v) => v.id) })
      .getRawMany();
    const num = (x: string | null) => (x === null ? null : Number(x));
    for (const r of rows) {
      out.set(r.id, {
        course: { id: r.courseId, code: r.courseCode, title: r.courseTitle, entityId: r.entityId },
        courseModule: {
          id: r.moduleId,
          moduleNumber: Number(r.moduleNumber),
          title: r.moduleTitle,
          coreHours: num(r.coreHours),
          oftHoursMin: num(r.oftHoursMin),
          oftHoursMax: num(r.oftHoursMax),
        },
        track: { id: r.trackId, code: r.trackCode, name: r.trackName, isActive: r.trackUsable === true },
      });
    }
    return out;
  }
}

export const lmsTrackVariantRepository = new LmsTrackVariantRepository();
