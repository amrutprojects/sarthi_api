import type { Request, Response } from 'express';
import { body, params, query } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { batchService } from './batch.service';
import type { BatchOptionsQuery, CreateBatchBody, ListBatchesQuery, UpdateBatchBody } from './batch.validator';

type IdParams = { id: string };

export const batchController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await batchService.list(query<ListBatchesQuery>(req));
    ApiResponse.ok(res, page.items, 'Batches retrieved successfully', page.meta);
  }),

  options: asyncHandler(async (req: Request, res: Response) => {
    const { assignable } = query<BatchOptionsQuery>(req);
    ApiResponse.ok(res, await batchService.options(assignable ?? false), 'Batches retrieved successfully');
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await batchService.get(params<IdParams>(req).id), 'Batch retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await batchService.create(body<CreateBatchBody>(req), req), 'Batch created successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await batchService.update(params<IdParams>(req).id, body<UpdateBatchBody>(req), req), 'Batch updated successfully');
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    ApiResponse.ok(res, await batchService.setStatus(params<IdParams>(req).id, isActive, req), isActive ? 'Batch activated' : 'Batch deactivated');
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await batchService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Batch deleted successfully');
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await batchService.restore(params<IdParams>(req).id, req), 'Batch restored (inactive)');
  }),
};
