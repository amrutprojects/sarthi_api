import type { ListQuery } from '../../shared/utils/pagination';
import type { CalendarType, Weekday } from './calendar.constants';
import type {
  LearningConfigKind, LearningConfigMode, LearningConfigType, LearningConfigUnit, LearningConfigValue,
} from './learning-config.constants';

/* Columns a client may sort by (?sortBy=). */
export type LmsCalendarSortField = 'name' | 'validFrom' | 'validTo' | 'createdAt' | 'updatedAt';

/* L-05 "Filter by year, centre, type" plus the owning entity (F-LMS-05-02 "Filter"). */
export interface LmsCalendarListQuery extends ListQuery<LmsCalendarSortField> {
  entityId?: string;
  centreId?: string;
  type?: CalendarType;
  /* Calendars whose period touches this calendar year. */
  year?: number;
  /* true: ONLY soft-deleted calendars (the "Show deleted" list); otherwise only the non-deleted ones. */
  deleted?: boolean;
}

export interface CalendarHolidayInput {
  date: string;
  name: string;
}

export interface PublicCalendarHoliday {
  id: string;
  date: string;
  name: string;
}

/* The owning entity / the exception centre, with isActive = usable right now (active and not deleted). */
export interface CalendarRef {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
}

/* API shape of a calendar. holidays only on the single-record response; holidayCount on both. */
export interface PublicLmsCalendar {
  id: string;
  name: string;
  entityId: string;
  entity: CalendarRef | null;
  centreId: string | null;
  centre: CalendarRef | null;
  type: CalendarType;
  validFrom: string;
  validTo: string;
  workingDays: Weekday[];
  holidayCount: number;
  holidays?: PublicCalendarHoliday[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LmsCalendarOption {
  id: string;
  name: string;
  centreId: string | null;
  validFrom: string;
  validTo: string;
}

export interface LmsCalendarFormOptions {
  weekdays: { code: Weekday; label: string }[];
  types: CalendarType[];
}

export interface CreateLmsCalendarInput {
  entityId: string;
  centreId?: string | null;
  name: string;
  validFrom: string;
  validTo: string;
  workingDays: Weekday[];
  holidays: CalendarHolidayInput[];
  isActive?: boolean;
}

/* undefined = not sent (left alone); centreId null = all centres. holidays, when sent, replace the whole set. */
export interface UpdateLmsCalendarInput {
  centreId?: string | null;
  name?: string;
  validFrom?: string;
  validTo?: string;
  workingDays?: Weekday[];
  holidays?: CalendarHolidayInput[];
}

/* ---- Learning configuration (F-LMS-05-07) ---- */

export interface PublicLearningConfigValue {
  key: string;
  label: string;
  group: string;
  type: LearningConfigType;
  unit: LearningConfigUnit | null;
  min: number | null;
  options: string[] | null;
  length: number | null;
  kind: LearningConfigKind;
  /* null for keys that do not differ by delivery mode. */
  mode: LearningConfigMode | null;
  value: LearningConfigValue | null;
  /* SYLLABUS: the syllabus value is shown (nothing saved yet) · CONFIGURED: saved by a user · null: To Be Confirmed. */
  valueSource: 'SYLLABUS' | 'CONFIGURED' | null;
  syllabusValue: LearningConfigValue | null;
  sourceNote: string | null;
  toBeConfirmed: boolean;
  openQuestions: string[];
  reason: string | null;
  updatedAt: Date | null;
}

export interface LearningConfigView {
  entityId: string;
  keys: PublicLearningConfigValue[];
}

export interface UpdateLearningConfigInput {
  entityId: string;
  /* Mode-specific keys only; omitted = both modes alike (OQ-042). */
  mode?: LearningConfigMode;
  value: unknown;
  reason: string;
}
