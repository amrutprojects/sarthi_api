import { z } from 'zod';
import { MAX_RANGE_DAYS } from './attendance-reports.constants';

/*
 * Query of GET /attendance-reports. Panel conventions (camelCase); the service turns it into the LMS's wire names.
 * Limits stay inside the LMS's own (codes ≤ 40 characters, dates YYYY-MM-DD, at most 366 days), so a query the Panel
 * accepts is one the LMS accepts.
 */
const code = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_.:-]+$/, 'Letters, digits, _ . : - only');
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Not a date');

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

export const attendanceReportQuery = z
  .object({
    /* The rows: one per division, district, centre or batch. */
    level: z.enum(['division', 'district', 'centre', 'batch']).default('division'),
    /* Default (LMS): the last 30 days; at most 366 days. */
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
    /* Drill-down: only rows under this division (LMS division code, e.g. PUNE) … */
    division: code.optional(),
    /* … this district (Amrut District Master code) … */
    district: code.optional(),
    /* … or this centre (Training Centre code). */
    centre: code.optional(),
    /* One of Amrut's LMS entities (the LMS default: all of them). */
    entityCode: code.optional(),
  })
  .refine((q) => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo, { message: 'dateFrom must not be after dateTo', path: ['dateFrom'] })
  .refine((q) => !q.dateFrom || !q.dateTo || days(q.dateFrom, q.dateTo) <= MAX_RANGE_DAYS, {
    message: `The range may be at most ${MAX_RANGE_DAYS} days`,
    path: ['dateTo'],
  });

export type AttendanceReportQuery = z.infer<typeof attendanceReportQuery>;
