/*
 * Fixed values of the Academic Calendar master (L-05 / F-LMS-05), each in ONE place.
 */

/* F-LMS-05-05: Monday to Sunday, stored in this order. Same list as CHK_lms_academic_calendars_working_days. */
export const WEEKDAYS = [
  { code: 'MON', label: 'Monday' },
  { code: 'TUE', label: 'Tuesday' },
  { code: 'WED', label: 'Wednesday' },
  { code: 'THU', label: 'Thursday' },
  { code: 'FRI', label: 'Friday' },
  { code: 'SAT', label: 'Saturday' },
  { code: 'SUN', label: 'Sunday' },
] as const;

export type Weekday = (typeof WEEKDAYS)[number]['code'];

export const WEEKDAY_CODES = WEEKDAYS.map((d) => d.code) as [Weekday, ...Weekday[]];

/* Working days in Monday→Sunday order, whatever order the client sent. */
export const sortWeekdays = (days: readonly Weekday[]): Weekday[] => WEEKDAY_CODES.filter((d) => days.includes(d));

/*
 * L-05 "Filter by … type": an entity-wide calendar (no centre: "All centres") or a centre exception
 * calendar (F-LMS-05-03).
 */
export const CALENDAR_TYPES = ['ENTITY', 'CENTRE'] as const;
export type CalendarType = (typeof CALENDAR_TYPES)[number];
