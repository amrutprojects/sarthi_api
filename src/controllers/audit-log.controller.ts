import type { Request, Response } from 'express';
import { query } from '../middleware/validate-request.middleware';
import { auditLogRepository } from '../repositories/audit-log.repository';
import { ApiResponse } from '../utils/api-response';
import { asyncHandler } from '../utils/async-handler';
import type { ListAuditLogsQuery } from '../validators/audit-log.validator';

export const auditLogController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await auditLogRepository.list(query<ListAuditLogsQuery>(req));
    ApiResponse.ok(res, page.items, 'Audit log retrieved successfully', page.meta);
  }),
};
