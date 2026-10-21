import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { auditService } from '../../modules/audit';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { AppError } from '../../shared/errors/app-error';
import type { Paginated } from '../../shared/utils/pagination';
import { assertUsableRef, lockForUpdate } from '../../masters/shared/master-refs';
import { LmsEntity } from '../entity/entity.model';
import { assertCentreEnabled } from '../entity/entity.refs';
import { CALENDAR_TYPES, WEEKDAYS, type Weekday } from './calendar.constants';
import { LmsAcademicCalendar } from './calendar.model';
import { lmsCalendarRepository } from './calendar.repository';
import type {
  CalendarHolidayInput, CalendarRef, CreateLmsCalendarInput, LmsCalendarFormOptions, LmsCalendarListQuery, LmsCalendarOption,
  PublicCalendarHoliday, PublicLmsCalendar, UpdateLmsCalendarInput,
} from './calendar.types';

const conflict = (message: string, field: string, detail: string) => new AppError(409, message, 'CONFLICT', [{ field, message: detail }]);

const PERIOD_MESSAGE = 'The end date must be after the start date.';

const toPublic = (
  c: LmsAcademicCalendar,
  refs: { entities: Map<string, CalendarRef>; centres: Map<string, CalendarRef> },
  holidayCount: number,
): PublicLmsCalendar => ({
  id: c.id,
  name: c.name,
  entityId: c.entityId,
  entity: refs.entities.get(c.entityId) ?? null,
  centreId: c.centreId,
  centre: c.centreId ? (refs.centres.get(c.centreId) ?? null) : null,
  type: c.centreId ? 'CENTRE' : 'ENTITY',
  validFrom: c.validFrom,
  validTo: c.validTo,
  workingDays: c.workingDays,
  holidayCount,
  isActive: c.isActive,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

const sameDays = (a: readonly Weekday[], b: readonly Weekday[]) => a.length === b.length && a.every((d, i) => d === b[i]);

/*
 * Academic Calendar master — AMRUT_KALASH_03 L-05 / FR-305, form F-LMS-05 (Table 30), table DB-304.
 *
 * - A calendar belongs to one entity (F-LMS-05-02: ACTIVE when chosen; fixed afterwards) and optionally to one
 *   centre enabled for that entity — the centre exception calendar (F-LMS-05-03; assertCentreEnabled).
 * - Name 3–80, unique in the entity (case-insensitive) → 409 on name.
 * - Period: validTo later than validFrom (F-LMS-05-04); no overlap with another non-deleted calendar of the
 *   same entity and the same centre ("all centres" counts as one) → 409 on validFrom. An entity-wide calendar
 *   and a centre exception calendar may cover the same days: that is what the exception is for. Writes
 *   lock the entity row FOR UPDATE first, so two concurrent writes for one entity cannot both pass the check.
 * - Working days: ≥ 1 of Monday to Sunday, no default (F-LMS-05-05).
 * - Holidays: date inside the period, name 2–80, one per date (F-LMS-05-06). Sent as the whole set on create /
 *   update; each one added, renamed or removed is audited (holiday.added / removed). A period change that
 *   would leave a holiday outside it is refused.
 * - Delete (archive, DB-304) is a soft delete. Nothing in this system references a calendar yet (sessions,
 *   L-11, do not exist), so it is never blocked; the holidays are kept, so a restore brings them back.
 * - Every write runs in one transaction with its audit record (before / after values).
 */
export class LmsCalendarService {
  private async publicRows(rows: LmsAcademicCalendar[], m?: EntityManager): Promise<PublicLmsCalendar[]> {
    const [refs, counts] = await Promise.all([
      lmsCalendarRepository.refs(
        rows.map((c) => c.entityId),
        rows.flatMap((c) => (c.centreId ? [c.centreId] : [])),
        m,
      ),
      lmsCalendarRepository.holidayCounts(rows.map((c) => c.id), m),
    ]);
    return rows.map((c) => toPublic(c, refs, counts.get(c.id) ?? 0));
  }

  async list(q: LmsCalendarListQuery): Promise<Paginated<PublicLmsCalendar>> {
    const page = await lmsCalendarRepository.list(q);
    return { items: await this.publicRows(page.items), meta: page.meta };
  }

  async get(id: string): Promise<PublicLmsCalendar> {
    const calendar = await lmsCalendarRepository.findById(id);
    if (!calendar) throw AppError.notFound('Calendar not found');
    const [[row], holidays] = await Promise.all([this.publicRows([calendar]), lmsCalendarRepository.holidays(id)]);
    return { ...row, holidays: holidays.map((h) => ({ id: h.id, date: h.date, name: h.name })) };
  }

  /* Active calendars of an entity (and those covering a centre, when given), by start date. */
  async options(entityId: string, centreId?: string): Promise<LmsCalendarOption[]> {
    const rows = await lmsCalendarRepository.findSelectable(entityId, centreId);
    return rows.map((c) => ({ id: c.id, name: c.name, centreId: c.centreId, validFrom: c.validFrom, validTo: c.validTo }));
  }

  formOptions(): LmsCalendarFormOptions {
    return { weekdays: WEEKDAYS.map((d) => ({ code: d.code, label: d.label })), types: [...CALENDAR_TYPES] };
  }

  private async assertUniqueName(entityId: string, name: string, excludeId: string | undefined, m: EntityManager): Promise<void> {
    if (await lmsCalendarRepository.findByName(entityId, name, { excludeId, manager: m })) {
      throw conflict('A calendar with this name already exists in the entity', 'name', 'This name is already used in the entity.');
    }
  }

  private async assertNoOverlap(
    c: { entityId: string; centreId: string | null; validFrom: string; validTo: string },
    excludeId: string | undefined,
    m: EntityManager,
  ): Promise<void> {
    const other = await lmsCalendarRepository.findOverlapping(c.entityId, c.centreId, c.validFrom, c.validTo, { excludeId, manager: m });
    if (other) {
      throw conflict(
        `The period overlaps another calendar (${other.name}, ${other.validFrom} to ${other.validTo}).`,
        'validFrom',
        'The period overlaps another calendar.',
      );
    }
  }

  /* F-LMS-05-06: every holiday date inside [from, to]. */
  private assertHolidaysInPeriod(holidays: { date: string }[], from: string, to: string, field: (i: number) => string): void {
    const details = holidays.flatMap((h, i) =>
      h.date < from || h.date > to ? [{ field: field(i), message: `The date must be between ${from} and ${to}.` }] : [],
    );
    if (details.length) throw AppError.badRequest('A holiday falls outside the calendar period', details);
  }

  private async auditHolidays(
    m: EntityManager,
    req: Request | undefined,
    calendarId: string,
    changes: { added: PublicCalendarHoliday[]; renamed: (PublicCalendarHoliday & { before: string })[]; removed: PublicCalendarHoliday[] },
  ): Promise<void> {
    for (const h of changes.added) {
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_CALENDAR_DAY_CREATE,
        resource: 'lms-calendar-holiday',
        resourceId: h.id,
        details: { calendarId, after: { date: h.date, name: h.name } },
      });
    }
    for (const h of changes.renamed) {
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_CALENDAR_DAY_UPDATE,
        resource: 'lms-calendar-holiday',
        resourceId: h.id,
        details: { calendarId, date: h.date, before: { name: h.before }, after: { name: h.name } },
      });
    }
    for (const h of changes.removed) {
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_CALENDAR_DAY_DELETE,
        resource: 'lms-calendar-holiday',
        resourceId: h.id,
        details: { calendarId, before: { date: h.date, name: h.name } },
      });
    }
  }

  async create(input: CreateLmsCalendarInput, req?: Request): Promise<PublicLmsCalendar> {
    const id = await AppDataSource.transaction(async (m) => {
      /* FOR UPDATE: serialises the calendar writes of one entity (overlap check). */
      await assertUsableRef(m, LmsEntity, input.entityId, 'entityId', 'entity', 'pessimistic_write');
      const centreId = input.centreId ?? null;
      if (centreId) await assertCentreEnabled(m, input.entityId, centreId, 'centreId');
      await this.assertUniqueName(input.entityId, input.name, undefined, m);
      await this.assertNoOverlap({ entityId: input.entityId, centreId, validFrom: input.validFrom, validTo: input.validTo }, undefined, m);
      this.assertHolidaysInPeriod(input.holidays, input.validFrom, input.validTo, (i) => `holidays.${i}.date`);

      const calendar = await lmsCalendarRepository.create(
        {
          entityId: input.entityId,
          centreId,
          name: input.name,
          validFrom: input.validFrom,
          validTo: input.validTo,
          workingDays: input.workingDays,
          isActive: input.isActive ?? true,
        },
        m,
      );
      const added = await lmsCalendarRepository.addHolidays(calendar.id, input.holidays, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_CALENDAR_CREATE,
        resource: 'lms-calendar',
        resourceId: calendar.id,
        details: {
          after: {
            entityId: calendar.entityId,
            centreId: calendar.centreId,
            name: calendar.name,
            validFrom: calendar.validFrom,
            validTo: calendar.validTo,
            workingDays: calendar.workingDays,
            isActive: calendar.isActive,
          },
        },
      });
      await this.auditHolidays(m, req, calendar.id, { added, renamed: [], removed: [] });
      return calendar.id;
    });
    return this.get(id);
  }

  async update(id: string, input: UpdateLmsCalendarInput, req?: Request): Promise<PublicLmsCalendar> {
    await AppDataSource.transaction(async (m) => {
      const found = await lmsCalendarRepository.findById(id, { manager: m });
      if (!found) throw AppError.notFound('Calendar not found');
      /* Entity first (same lock order as create), then the calendar itself. */
      if (!(await lockForUpdate(m, LmsEntity, found.entityId))) throw AppError.conflict('The entity of this calendar has been deleted');
      const calendar = await lockForUpdate(m, LmsAcademicCalendar, id);
      if (!calendar) throw AppError.notFound('Calendar not found');

      const next = {
        entityId: calendar.entityId,
        centreId: input.centreId !== undefined ? input.centreId : calendar.centreId,
        name: input.name ?? calendar.name,
        validFrom: input.validFrom ?? calendar.validFrom,
        validTo: input.validTo ?? calendar.validTo,
        workingDays: input.workingDays ?? calendar.workingDays,
      };
      if (next.validTo <= next.validFrom) {
        throw AppError.badRequest(PERIOD_MESSAGE, [{ field: input.validTo !== undefined ? 'validTo' : 'validFrom', message: PERIOD_MESSAGE }]);
      }
      const centreChanged = next.centreId !== calendar.centreId;
      const periodChanged = next.validFrom !== calendar.validFrom || next.validTo !== calendar.validTo;

      if (next.name !== calendar.name) await this.assertUniqueName(calendar.entityId, next.name, id, m);
      /* A newly chosen centre must be enabled for the entity now; a centre kept as it was is not re-checked. */
      if (centreChanged && next.centreId) await assertCentreEnabled(m, calendar.entityId, next.centreId, 'centreId');
      if (centreChanged || periodChanged) await this.assertNoOverlap(next, id, m);

      const existing = await lmsCalendarRepository.holidays(id, m);
      let changes: Parameters<LmsCalendarService['auditHolidays']>[3] = { added: [], renamed: [], removed: [] };
      if (input.holidays) {
        this.assertHolidaysInPeriod(input.holidays, next.validFrom, next.validTo, (i) => `holidays.${i}.date`);
        changes = await this.replaceHolidays(id, existing, input.holidays, m);
      } else if (periodChanged) {
        const outside = existing.filter((h) => h.date < next.validFrom || h.date > next.validTo);
        if (outside.length) {
          throw AppError.badRequest('Holidays fall outside the new period', [
            {
              field: input.validFrom !== undefined ? 'validFrom' : 'validTo',
              message: `Remove or move the holidays outside the period first: ${outside.map((h) => h.date).join(', ')}.`,
            },
          ]);
        }
      }

      const columns: Partial<Pick<LmsAcademicCalendar, 'centreId' | 'name' | 'validFrom' | 'validTo' | 'workingDays'>> = {};
      const before: Record<string, unknown> = {};
      const set = <K extends keyof typeof columns>(key: K, value: (typeof columns)[K], changed: boolean) => {
        if (!changed) return;
        columns[key] = value;
        before[key] = calendar[key];
      };
      set('centreId', next.centreId, centreChanged);
      set('name', next.name, next.name !== calendar.name);
      set('validFrom', next.validFrom, next.validFrom !== calendar.validFrom);
      set('validTo', next.validTo, next.validTo !== calendar.validTo);
      set('workingDays', next.workingDays, !sameDays(next.workingDays, calendar.workingDays));

      if (Object.keys(columns).length) await lmsCalendarRepository.update(id, columns, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_CALENDAR_UPDATE,
        resource: 'lms-calendar',
        resourceId: id,
        details: { fields: Object.keys(columns), before, after: columns },
      });
      await this.auditHolidays(m, req, id, changes);
    });
    return this.get(id);
  }

  /* The whole holiday set: new dates added, dates no longer listed removed, same date with a new name renamed. */
  private async replaceHolidays(
    calendarId: string,
    existing: PublicCalendarHoliday[],
    next: CalendarHolidayInput[],
    m: EntityManager,
  ): Promise<Parameters<LmsCalendarService['auditHolidays']>[3]> {
    const byDate = new Map(existing.map((h) => [h.date, h]));
    const nextDates = new Set(next.map((h) => h.date));
    const removed = existing.filter((h) => !nextDates.has(h.date)).map((h) => ({ id: h.id, date: h.date, name: h.name }));
    const renamed = next.flatMap((h) => {
      const old = byDate.get(h.date);
      return old && old.name !== h.name ? [{ id: old.id, date: h.date, name: h.name, before: old.name }] : [];
    });
    /* Removed rows first: the partial unique index (calendarId, date) only covers non-deleted rows. */
    await lmsCalendarRepository.removeHolidays(removed.map((h) => h.id), m);
    for (const h of renamed) await lmsCalendarRepository.renameHoliday(h.id, h.name, m);
    const added = await lmsCalendarRepository.addHolidays(calendarId, next.filter((h) => !byDate.has(h.date)), m);
    return { added, renamed, removed };
  }

  async setStatus(id: string, isActive: boolean, req?: Request): Promise<PublicLmsCalendar> {
    await AppDataSource.transaction(async (m) => {
      const calendar = await lockForUpdate(m, LmsAcademicCalendar, id);
      if (!calendar) throw AppError.notFound('Calendar not found');
      await lmsCalendarRepository.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_CALENDAR_STATUS,
        resource: 'lms-calendar',
        resourceId: id,
        details: { before: { isActive: calendar.isActive }, after: { isActive }, name: calendar.name },
      });
    });
    return this.get(id);
  }

  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const calendar = await lockForUpdate(m, LmsAcademicCalendar, id);
      if (!calendar) throw AppError.notFound('Calendar not found');
      await lmsCalendarRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_CALENDAR_DELETE,
        resource: 'lms-calendar',
        resourceId: id,
        details: { name: calendar.name, entityId: calendar.entityId, centreId: calendar.centreId, validFrom: calendar.validFrom, validTo: calendar.validTo },
      });
    });
  }

  /* Brings a deleted calendar back, inactive. Refused when its entity is deleted, its centre is no longer enabled, or its name or period is taken meanwhile. */
  async restore(id: string, req?: Request): Promise<PublicLmsCalendar> {
    await AppDataSource.transaction(async (m) => {
      const existing = await lmsCalendarRepository.findByIdIncludingDeleted(id, m);
      if (!existing) throw AppError.notFound('Calendar not found');
      if (!existing.isDelete) throw AppError.conflict('Calendar is not deleted');
      if (!(await lockForUpdate(m, LmsEntity, existing.entityId))) {
        throw AppError.conflict('The entity of this calendar has been deleted. Restore the entity first.');
      }
      /* F-LMS-05-03: a centre exception calendar comes back only while its centre is enabled for the entity. */
      if (existing.centreId) await assertCentreEnabled(m, existing.entityId, existing.centreId, 'centreId');
      await this.assertUniqueName(existing.entityId, existing.name, id, m);
      await this.assertNoOverlap(existing, id, m);
      await lmsCalendarRepository.restore(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_CALENDAR_RESTORE,
        resource: 'lms-calendar',
        resourceId: id,
        details: { name: existing.name, entityId: existing.entityId },
      });
    });
    return this.get(id);
  }
}

export const lmsCalendarService = new LmsCalendarService();
