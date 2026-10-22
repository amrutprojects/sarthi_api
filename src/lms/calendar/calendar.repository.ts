import { Brackets, In, type EntityManager, type EntityTarget, type FindOptionsWhere } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import type { AppBaseEntity } from '../../database/base.entity';
import { BaseRepository } from '../../database/base.repository';
import { TrainingCentre } from '../../masters/training-centre/training-centre.model';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../shared/utils/pagination';
import { LmsEntity } from '../entity/entity.model';
import { LmsCalendarHoliday } from './calendar-holiday.model';
import { LmsAcademicCalendar } from './calendar.model';
import type { CalendarRef, LmsCalendarListQuery, LmsCalendarSortField, PublicCalendarHoliday } from './calendar.types';
import { LmsLearningConfig } from './learning-config.model';

/* sortBy to SQL expression; only these columns are sortable. */
const SORT_SQL: Record<LmsCalendarSortField, string> = {
  name: 'c.name',
  validFrom: 'c.validFrom',
  validTo: 'c.validTo',
  createdAt: 'c.createdAt',
  updatedAt: 'c.updatedAt',
};

const manager = (m?: EntityManager) => m ?? AppDataSource.manager;

export class LmsCalendarRepository extends BaseRepository<LmsAcademicCalendar> {
  constructor() {
    super(LmsAcademicCalendar);
  }

  /* Matches UQ_lms_academic_calendars_name_active (per entity, case-insensitive, non-deleted rows). */
  findByName(entityId: string, name: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<LmsAcademicCalendar | null> {
    const qb = this.query('c', opts.manager)
      .andWhere('c.entityId = :entityId', { entityId })
      .andWhere('lower(c.name) = lower(:name)', { name });
    if (opts.excludeId) qb.andWhere('c.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  /*
   * A non-deleted calendar of the same entity and the same centre (both "all centres" when centreId is
   * null) whose period shares at least one day with [from, to] (F-LMS-05-04 "no overlap").
   */
  findOverlapping(
    entityId: string,
    centreId: string | null,
    from: string,
    to: string,
    opts: { excludeId?: string; manager?: EntityManager } = {},
  ): Promise<LmsAcademicCalendar | null> {
    const qb = this.query('c', opts.manager)
      .andWhere('c.entityId = :entityId', { entityId })
      .andWhere('c.validFrom <= :to AND c.validTo >= :from', { from, to });
    if (centreId) qb.andWhere('c.centreId = :centreId', { centreId });
    else qb.andWhere('c.centreId IS NULL');
    if (opts.excludeId) qb.andWhere('c.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.orderBy('c.validFrom', 'ASC').getOne();
  }

  async list(q: LmsCalendarListQuery): Promise<Paginated<LmsAcademicCalendar>> {
    /* deleted: ONLY the soft-deleted rows (the explicit "Show deleted" list); otherwise the non-deleted ones, as query() does. */
    const qb = this.repo().createQueryBuilder('c').where('c.isDelete = :isDelete', { isDelete: q.deleted === true });
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(new Brackets((w) => w.where('c.name ILIKE :term', { term })));
    }
    if (q.isActive !== undefined) qb.andWhere('c.isActive = :isActive', { isActive: q.isActive });
    if (q.entityId) qb.andWhere('c.entityId = :entityId', { entityId: q.entityId });
    if (q.centreId) qb.andWhere('c.centreId = :centreId', { centreId: q.centreId });
    if (q.type === 'ENTITY') qb.andWhere('c.centreId IS NULL');
    if (q.type === 'CENTRE') qb.andWhere('c.centreId IS NOT NULL');
    if (q.year !== undefined) {
      qb.andWhere('c.validFrom <= :yearEnd AND c.validTo >= :yearStart', { yearStart: `${q.year}-01-01`, yearEnd: `${q.year}-12-31` });
    }
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.orderBy(SORT_SQL[q.sortBy], q.sortOrder).addOrderBy('c.id').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /* Calendars offered in a dropdown: active, of one entity (and centre when given), by start date. */
  findSelectable(entityId: string, centreId?: string): Promise<LmsAcademicCalendar[]> {
    const qb = this.query('c').andWhere('c.isActive = true').andWhere('c.entityId = :entityId', { entityId });
    if (centreId) qb.andWhere('(c.centreId IS NULL OR c.centreId = :centreId)', { centreId });
    return qb.orderBy('c.validFrom', 'ASC').addOrderBy('c.name', 'ASC').getMany();
  }

  /* Entities and centres by id, read whatever their state, with isActive = usable now. */
  async refs(entityIds: string[], centreIds: string[], m?: EntityManager): Promise<{ entities: Map<string, CalendarRef>; centres: Map<string, CalendarRef> }> {
    const load = async <T extends AppBaseEntity & { name: string; code: string }>(target: EntityTarget<T>, ids: string[]) => {
      const out = new Map<string, CalendarRef>();
      if (!ids.length) return out;
      const rows = await manager(m)
        .getRepository(target)
        .find({ where: { id: In([...new Set(ids)]) } as FindOptionsWhere<T> });
      for (const r of rows) out.set(r.id, { id: r.id, name: r.name, code: r.code, isActive: r.isActive && !r.isDelete });
      return out;
    };
    const [entities, centres] = await Promise.all([load(LmsEntity, entityIds), load(TrainingCentre, centreIds)]);
    return { entities, centres };
  }

  /* ---- holidays ---- */

  async holidays(calendarId: string, m?: EntityManager): Promise<LmsCalendarHoliday[]> {
    return manager(m).getRepository(LmsCalendarHoliday).find({ where: { calendarId, isDelete: false }, order: { date: 'ASC' } });
  }

  async holidayCounts(calendarIds: string[], m?: EntityManager): Promise<Map<string, number>> {
    const out = new Map<string, number>(calendarIds.map((id) => [id, 0]));
    if (!calendarIds.length) return out;
    const rows: { calendarId: string; n: string }[] = await manager(m)
      .getRepository(LmsCalendarHoliday)
      .createQueryBuilder('h')
      .select('h.calendarId', 'calendarId')
      .addSelect('COUNT(*)', 'n')
      .where('h.isDelete = false')
      .andWhere('h.calendarId IN (:...calendarIds)', { calendarIds })
      .groupBy('h.calendarId')
      .getRawMany();
    for (const r of rows) out.set(r.calendarId, Number(r.n));
    return out;
  }

  async addHolidays(calendarId: string, rows: { date: string; name: string }[], m: EntityManager): Promise<PublicCalendarHoliday[]> {
    if (!rows.length) return [];
    const repo = m.getRepository(LmsCalendarHoliday);
    const saved = await repo.save(rows.map((r) => repo.create({ calendarId, date: r.date, name: r.name })));
    return saved.map((h) => ({ id: h.id, date: h.date, name: h.name }));
  }

  async renameHoliday(id: string, name: string, m: EntityManager): Promise<void> {
    await m.getRepository(LmsCalendarHoliday).update({ id, isDelete: false }, { name });
  }

  async removeHolidays(ids: string[], m: EntityManager): Promise<void> {
    if (ids.length) await m.getRepository(LmsCalendarHoliday).update({ id: In(ids), isDelete: false }, { isDelete: true, isActive: false });
  }

  /* ---- learning configuration ---- */

  currentConfig(entityId: string, m?: EntityManager): Promise<LmsLearningConfig[]> {
    return manager(m).getRepository(LmsLearningConfig).find({ where: { entityId, isDelete: false } });
  }
}

export const lmsCalendarRepository = new LmsCalendarRepository();
