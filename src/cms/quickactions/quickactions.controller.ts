import type { Request, Response } from 'express';
import { body, params } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { quickActionsService } from './quickactions.service';
import type { CreateQuickActionBody, ReorderBody, UpdateQuickActionBody } from './quickactions.validator';

type IdParams = { id: string };

export const quickActionsController = {
  list: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await quickActionsService.listForAdmin(), 'Quick actions retrieved successfully');
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await quickActionsService.getForAdmin(params<IdParams>(req).id), 'Quick action retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await quickActionsService.create(body<CreateQuickActionBody>(req), req), 'Quick action created successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await quickActionsService.update(params<IdParams>(req).id, body<UpdateQuickActionBody>(req), req);
    ApiResponse.ok(res, data, 'Quick action updated successfully');
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    const data = await quickActionsService.setActive(params<IdParams>(req).id, isActive, req);
    ApiResponse.ok(res, data, isActive ? 'Quick action shown on the website' : 'Quick action hidden from the website');
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await quickActionsService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Quick action deleted successfully');
  }),

  reorder: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await quickActionsService.reorder(body<ReorderBody>(req).ids, req), 'Display order updated successfully');
  }),

  /*
   * Public read. `null` is a legitimate answer — the strip has not been configured — so it is a 200
   * with no data rather than a 404.
   */
  public: asyncHandler(async (_req: Request, res: Response) => {
    const data = await quickActionsService.getPublic();
    ApiResponse.ok(res, data, data ? 'Quick actions retrieved successfully' : 'Quick actions are not configured');
  }),
};
