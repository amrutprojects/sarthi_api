import type { Request, Response } from 'express';
import { body, params, query } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { eligibilityService } from './eligibility.service';
import type {
  CreateEligibilityItemBody,
  ListEligibilityItemsQuery,
  UpdateEligibilityItemBody,
  UpdateEligibilitySettingsBody,
} from './eligibility.validator';

type IdParams = { id: string };

export const eligibilityController = {
  /* ---------------- page text ---------------- */

  getSettings: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await eligibilityService.getSettings(), 'Eligibility page text retrieved successfully');
  }),

  updateSettings: asyncHandler(async (req: Request, res: Response) => {
    const data = await eligibilityService.updateSettings(body<UpdateEligibilitySettingsBody>(req), req);
    ApiResponse.ok(res, data, 'Eligibility page text updated successfully');
  }),

  /* ---------------- criteria and documents ---------------- */

  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await eligibilityService.list(query<ListEligibilityItemsQuery>(req));
    ApiResponse.ok(res, page.items, 'Eligibility items retrieved successfully', page.meta);
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await eligibilityService.get(params<IdParams>(req).id), 'Eligibility item retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(
      res,
      await eligibilityService.create(body<CreateEligibilityItemBody>(req), req),
      'Eligibility item created successfully',
    );
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await eligibilityService.update(params<IdParams>(req).id, body<UpdateEligibilityItemBody>(req), req);
    ApiResponse.ok(res, data, 'Eligibility item updated successfully');
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    ApiResponse.ok(
      res,
      await eligibilityService.setStatus(params<IdParams>(req).id, isActive, req),
      isActive ? 'Eligibility item activated' : 'Eligibility item deactivated',
    );
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await eligibilityService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Eligibility item deleted successfully');
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await eligibilityService.restore(params<IdParams>(req).id, req), 'Eligibility item restored (inactive)');
  }),

  /*
   * Public read. `null` is a legitimate answer — the page has not been configured — so it is a 200
   * with no data rather than a 404: the website treats it as "show the bundled copy", which is not
   * an error condition.
   */
  public: asyncHandler(async (_req: Request, res: Response) => {
    const data = await eligibilityService.getPublic();
    ApiResponse.ok(res, data, data ? 'Eligibility page retrieved successfully' : 'Eligibility page is not configured');
  }),
};
