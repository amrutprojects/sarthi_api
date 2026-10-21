import type { Request, Response } from 'express';
import { body, params, query } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { centreLocationService } from './centre-location.service';
import type { CreateCentreLocationBody, ListCentreLocationsQuery, UpdateCentreLocationBody } from './centre-location.validator';

type IdParams = { id: string };

export const centreLocationController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await centreLocationService.list(query<ListCentreLocationsQuery>(req));
    ApiResponse.ok(res, page.items, 'Location information retrieved successfully', page.meta);
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await centreLocationService.get(params<IdParams>(req).id), 'Location information retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(
      res,
      await centreLocationService.create(body<CreateCentreLocationBody>(req), req),
      'Location information created successfully',
    );
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      await centreLocationService.update(params<IdParams>(req).id, body<UpdateCentreLocationBody>(req), req),
      'Location information updated successfully',
    );
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    ApiResponse.ok(
      res,
      await centreLocationService.setStatus(params<IdParams>(req).id, isActive, req),
      isActive ? 'Location information activated' : 'Location information deactivated',
    );
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await centreLocationService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Location information deleted successfully');
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await centreLocationService.restore(params<IdParams>(req).id, req), 'Location information restored (inactive)');
  }),
};
