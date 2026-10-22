import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { LmsAcademicCalendar } from './calendar.model';

/*
 * A holiday (non-working day) of an academic calendar (F-LMS-05-06; DB-304 holiday): a date inside the
 * calendar period and a name of 2–80 characters, one per date per calendar (non-deleted rows).
 * Removing a holiday soft-deletes its row; adding the date again inserts a new one.
 */
@Entity({ name: 'lms_calendar_holidays' })
export class LmsCalendarHoliday extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'calendarId' })
  calendarId!: string;

  @Column({ type: 'date', name: 'date' })
  date!: string;

  @Column({ type: 'varchar', length: 80 })
  name!: string;

  @ManyToOne('LmsAcademicCalendar', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'calendarId' })
  calendar!: LmsAcademicCalendar;
}
