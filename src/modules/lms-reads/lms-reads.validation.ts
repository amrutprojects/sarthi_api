import { z } from 'zod';
import { PAGINATION } from '../../shared/constants/app.constants';

/*
 * Query schemas of the /lms-reads routes. Panel conventions (page / limit, camelCase); the service turns them into the
 * LMS's wire names (page / page_size, snake_case). Limits stay inside the LMS's own (page_size ≤ 200, entity_code ≤ 40,
 * dates YYYY-MM-DD), so a query the Panel accepts is one the LMS accepts.
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

export const lmsSummaryQuery = z.object({ entityCode: code.optional() });

export const lmsListQuery = z.object({
  page: z.coerce.number().int().min(1).default(PAGINATION.DEFAULT_PAGE),
  limit: z.coerce.number().int().min(1).max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
  /* Only rows the LMS changed after this instant (ISO 8601 with offset). */
  updatedSince: z.string().datetime({ offset: true }).optional(),
  entityCode: code.optional(),
});

export const lmsLiveSessionsQuery = z.object({
  /* The IST civil date; the LMS uses today when absent. */
  date: isoDate.optional(),
  centreCode: code.optional(),
  batchCode: code.optional(),
  deliveryMode: z.enum(['OFFLINE', 'ONLINE']).optional(),
});

export const lmsAttendanceQuery = z
  .object({
    groupBy: z.enum(['district', 'division', 'centre', 'batch']).default('district'),
    /* Default (LMS): the last 30 days; at most 366 days. */
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
    entityCode: code.optional(),
  })
  .refine((q) => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo, { message: 'dateFrom must not be after dateTo', path: ['dateFrom'] });

export type LmsSummaryQuery = z.infer<typeof lmsSummaryQuery>;
export type LmsListQuery = z.infer<typeof lmsListQuery>;
export type LmsLiveSessionsQuery = z.infer<typeof lmsLiveSessionsQuery>;
export type LmsAttendanceQuery = z.infer<typeof lmsAttendanceQuery>;
