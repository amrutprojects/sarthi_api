import type { Request, Response } from 'express';
import { query } from '../../middleware/validate-request.middleware';
import { toAuditLogDto } from './audit-log.mapper';
import { auditLogRepository } from './audit-log.repository';
import { ApiResponse } from '../../shared/http/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import type { ListAuditLogsQuery } from './audit-log.validation';

export const auditLogController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await auditLogRepository.list(query<ListAuditLogsQuery>(req));
    ApiResponse.ok(res, page.items.map(toAuditLogDto), 'Audit log retrieved successfully', page.meta);
  }),
};
