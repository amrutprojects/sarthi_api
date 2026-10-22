import type { Request, Response } from 'express';
import { body, params, query } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { applyService } from './apply.service';
import type { CreateApplyItemBody, ListApplyItemsQuery, UpdateApplyItemBody, UpdateApplySettingsBody } from './apply.validator';

type IdParams = { id: string };

export const applyController = {
  /* ---------------- page text ---------------- */

  getSettings: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await applyService.getSettings(), 'Apply page text retrieved successfully');
  }),

  updateSettings: asyncHandler(async (req: Request, res: Response) => {
    const data = await applyService.updateSettings(body<UpdateApplySettingsBody>(req), req);
    ApiResponse.ok(res, data, 'Apply page text updated successfully');
  }),

  /* ---------------- steps and "At a glance" rows ---------------- */

  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await applyService.list(query<ListApplyItemsQuery>(req));
    ApiResponse.ok(res, page.items, 'Apply page items retrieved successfully', page.meta);
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await applyService.get(params<IdParams>(req).id), 'Apply page item retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await applyService.create(body<CreateApplyItemBody>(req), req), 'Apply page item created successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await applyService.update(params<IdParams>(req).id, body<UpdateApplyItemBody>(req), req);
    ApiResponse.ok(res, data, 'Apply page item updated successfully');
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    ApiResponse.ok(
      res,
      await applyService.setStatus(params<IdParams>(req).id, isActive, req),
      isActive ? 'Apply page item activated' : 'Apply page item deactivated',
    );
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await applyService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Apply page item deleted successfully');
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await applyService.restore(params<IdParams>(req).id, req), 'Apply page item restored (inactive)');
  }),

  /*
   * Public read. `null` is a legitimate answer — the page has not been configured — so it is a 200
   * with no data rather than a 404: the website treats it as "show the bundled copy", which is not
   * an error condition.
   */
  public: asyncHandler(async (_req: Request, res: Response) => {
    const data = await applyService.getPublic();
    ApiResponse.ok(res, data, data ? 'Apply page retrieved successfully' : 'Apply page is not configured');
  }),
};
