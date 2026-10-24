import type { Request, Response } from 'express';
import { body, params } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { topBarService } from './topbar.service';
import type { CreateTopBarLinkBody, ReorderBody, UpdateSettingsBody, UpdateTopBarLinkBody } from './topbar.validator';

type IdParams = { id: string };

export const topBarController = {
  list: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await topBarService.listForAdmin(), 'Top Bar links retrieved successfully');
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await topBarService.getForAdmin(params<IdParams>(req).id), 'Top Bar link retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await topBarService.create(body<CreateTopBarLinkBody>(req), req), 'Top Bar link created successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await topBarService.update(params<IdParams>(req).id, body<UpdateTopBarLinkBody>(req), req);
    ApiResponse.ok(res, data, 'Top Bar link updated successfully');
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    const data = await topBarService.setActive(params<IdParams>(req).id, isActive, req);
    ApiResponse.ok(res, data, isActive ? 'Top Bar link shown on the website' : 'Top Bar link hidden from the website');
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await topBarService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Top Bar link deleted successfully');
  }),

  reorder: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await topBarService.reorder(body<ReorderBody>(req).ids, req), 'Display order updated successfully');
  }),

  getSettings: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await topBarService.getSettings(), 'Top Bar settings retrieved successfully');
  }),

  updateSettings: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await topBarService.updateSettings(body<UpdateSettingsBody>(req), req), 'Top Bar settings updated successfully');
  }),

  /*
   * Public read. `null` is a legitimate answer — the Top Bar has not been configured — so it is a 200
   * with no data rather than a 404.
   */
  public: asyncHandler(async (_req: Request, res: Response) => {
    const data = await topBarService.getPublic();
    ApiResponse.ok(res, data, data ? 'Top Bar retrieved successfully' : 'The Top Bar is not configured');
  }),
};
