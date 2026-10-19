import type { Request, Response } from 'express';
import { body, params, query } from '../../../middleware/validate-request.middleware';
import { ApiResponse } from '../../../utils/api-response';
import { asyncHandler } from '../../../utils/async-handler';
import { geographyService } from '../geography/geography.service';
import { stateService } from './state.service';
import type { CreateStateBody, ListStatesQuery, UpdateStateBody } from './state.validator';

type IdParams = { id: string };
type StateIdParams = { stateId: string };

export const stateController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await stateService.list(query<ListStatesQuery>(req));
    ApiResponse.ok(res, page.items, 'States retrieved successfully', page.meta);
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await stateService.get(params<IdParams>(req).id), 'State retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await stateService.create(body<CreateStateBody>(req), req), 'State created successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await stateService.update(params<IdParams>(req).id, body<UpdateStateBody>(req), req), 'State updated successfully');
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    ApiResponse.ok(res, await stateService.setStatus(params<IdParams>(req).id, isActive, req), isActive ? 'State activated' : 'State deactivated');
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await stateService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'State deleted successfully');
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await stateService.restore(params<IdParams>(req).id, req), 'State restored (inactive)');
  }),

  /* Dropdown feed for the District and Taluka forms: the active districts of one state. */
  districts: asyncHandler(async (req: Request, res: Response) => {
    const options = await geographyService.districtsOfState(params<StateIdParams>(req).stateId);
    ApiResponse.ok(res, options, 'Districts retrieved successfully');
  }),
};
