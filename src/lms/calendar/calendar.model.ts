import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { TrainingCentre } from '../../masters/training-centre/training-centre.model';
import type { LmsEntity } from '../entity/entity.model';
import type { Weekday } from './calendar.constants';

/*
 * Academic calendar — the period, working days and holidays of one LMS entity, or of one of its centres
 * (AMRUT_KALASH_03 L-05 / FR-305, form F-LMS-05 Table 30, table DB-304 academic_calendar).
 *
 * A calendar with no centre covers all the entity's centres; one with a centre is that centre's exception
 * calendar (F-LMS-05-03). Status is AppBaseEntity.isActive; archive is the soft delete. Holidays are
 * lms_calendar_holidays (calendar-holiday.model.ts). Class schedules are not part of a calendar: sessions
 * (L-11) only read it.
 */
@Entity({ name: 'lms_academic_calendars' })
export class LmsAcademicCalendar extends AppBaseEntity {
  /* F-LMS-05-02: owner entity (ACTIVE when chosen). Fixed after creation. */
  @Column({ type: 'uuid', name: 'entityId' })
  entityId!: string;

  /* F-LMS-05-03: optional; a centre enabled for the entity. null = all centres. */
  @Column({ type: 'uuid', name: 'centreId', nullable: true })
  centreId!: string | null;

  /* F-LMS-05-01: 3–80 characters, unique in the entity (case-insensitive, non-deleted rows). */
  @Column({ type: 'varchar', length: 80 })
  name!: string;

  /* F-LMS-05-04: period covered; validTo is later than validFrom. DATE columns come back as 'YYYY-MM-DD'. */
  @Column({ type: 'date', name: 'validFrom' })
  validFrom!: string;

  @Column({ type: 'date', name: 'validTo' })
  validTo!: string;

  /* F-LMS-05-05: ≥ 1 of MON…SUN, Monday→Sunday order, no default. */
  @Column({ type: 'varchar', length: 3, array: true, name: 'workingDays' })
  workingDays!: Weekday[];

  @ManyToOne('LmsEntity', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'entityId' })
  entity!: LmsEntity;

  @ManyToOne('TrainingCentre', { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'centreId' })
  centre!: TrainingCentre | null;
}
