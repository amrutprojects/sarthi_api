import { z } from 'zod';
import { PAGINATION } from '../constants/app.constants';
import { uuid } from './common.validator';

export const listAuditLogsSchema = {
  query: z.object({
    page: z.coerce.number().int().min(1).default(PAGINATION.DEFAULT_PAGE),
    limit: z.coerce.number().int().min(1).max(PAGINATION.MAX_LIMIT).default(PAGINATION.DEFAULT_LIMIT),
    action: z.string().trim().max(100).optional(),
    resource: z.string().trim().max(64).optional(),
    resourceId: z.string().trim().max(100).optional(),
    actorUserId: uuid.optional(),
  }),
};

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsSchema.query>;
