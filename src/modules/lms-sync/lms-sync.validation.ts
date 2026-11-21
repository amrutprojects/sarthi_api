import { z } from 'zod';
import { idParams, uuid } from '../../shared/validation/common.validation';
import { SYNC_STATUSES } from './lms-sync.constants';

/* syncStatus accepts one value, a comma-separated list or a repeated parameter. */
const statusList = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim().toUpperCase()).filter(Boolean))
  .pipe(z.array(z.enum(SYNC_STATUSES)).max(SYNC_STATUSES.length));

export const listSyncSchema = {
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(25),
    syncStatus: statusList.optional().describe('NOT_SYNCED, PENDING, SENT, SYNCED, FAILED, REVIEW (comma-separated for several)'),
    scope: z
      .enum(['eligible', 'all'])
      .default('eligible')
      .describe('eligible = approved, active students (what the sync sends); all = every student'),
    search: z.string().trim().max(100).optional().describe('Student code or name'),
    centre: z.string().trim().max(10).optional(),
    errorCode: z.string().trim().max(60).optional(),
  }),
};
export const syncStudentSchema = { params: idParams };
export const pushSchema = { body: z.object({ studentIds: z.array(uuid).min(1).max(500) }).strict() };
export const retrySchema = { body: z.object({ studentIds: z.array(uuid).min(1).max(500).optional() }).strict() };

export type ListSyncQuery = z.infer<typeof listSyncSchema.query>;
