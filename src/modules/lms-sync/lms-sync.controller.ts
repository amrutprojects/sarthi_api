import type { Request, Response } from 'express';
import { auditService } from '../audit';
import { body, params, query } from '../../middleware/validate-request.middleware';
import { asyncHandler } from '../../shared/http/async-handler';
import { buildMeta } from '../../shared/utils/pagination';
import { ApiResponse } from '../../utils/api-response';
import { lmsSyncService } from './lms-sync.service';
import type { ListSyncQuery } from './lms-sync.validation';

export const lmsSyncController = {
  summary: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsSyncService.summary(), 'LMS sync summary retrieved');
  }),

  list: asyncHandler(async (req: Request, res: Response) => {
    const q = query<ListSyncQuery>(req);
    const { items, total } = await lmsSyncService.list(q);
    ApiResponse.ok(res, items, 'LMS sync status retrieved', buildMeta(q, total));
  }),

  detail: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsSyncService.detail(params<{ id: string }>(req).id), 'LMS sync detail retrieved');
  }),

  push: asyncHandler(async (req: Request, res: Response) => {
    const result = await lmsSyncService.push(body<{ studentIds: string[] }>(req).studentIds);
    await auditService.record(req, {
      action: 'lms_sync.push',
      resource: 'student',
      resourceId: null,
      details: { queued: result.queued, skipped: result.skipped, syncEnabled: result.syncEnabled },
    });
    ApiResponse.ok(res, result, result.syncEnabled ? 'Students queued for the LMS' : 'Students queued; the LMS sync is switched off');
  }),

  retry: asyncHandler(async (req: Request, res: Response) => {
    const result = await lmsSyncService.retry(body<{ studentIds?: string[] }>(req)?.studentIds);
    await auditService.record(req, {
      action: 'lms_sync.retry',
      resource: 'student',
      resourceId: null,
      details: { queued: result.queued, syncEnabled: result.syncEnabled },
    });
    ApiResponse.ok(res, result, 'Failed students queued again');
  }),

  run: asyncHandler(async (req: Request, res: Response) => {
    const stats = await lmsSyncService.run();
    await auditService.record(req, { action: 'lms_sync.run', resource: 'lms_sync', resourceId: null, details: { ...stats } });
    ApiResponse.ok(res, stats, 'LMS sync cycle finished');
  }),
};
