import type { Request, Response } from 'express';
import { body, params, query } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { centreTypeService } from './centre-type.service';
import type { CreateCentreTypeBody, ListCentreTypesQuery, UpdateCentreTypeBody } from './centre-type.validator';

type IdParams = { id: string };

export const centreTypeController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await centreTypeService.list(query<ListCentreTypesQuery>(req));
    ApiResponse.ok(res, page.items, 'Training centre types retrieved successfully', page.meta);
  }),

  options: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await centreTypeService.options(), 'Training centre types retrieved successfully');
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await centreTypeService.get(params<IdParams>(req).id), 'Training centre type retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(
      res,
      await centreTypeService.create(body<CreateCentreTypeBody>(req), req),
      'Training centre type created successfully',
    );
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      await centreTypeService.update(params<IdParams>(req).id, body<UpdateCentreTypeBody>(req), req),
      'Training centre type updated successfully',
    );
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    ApiResponse.ok(
      res,
      await centreTypeService.setStatus(params<IdParams>(req).id, isActive, req),
      isActive ? 'Training centre type activated' : 'Training centre type deactivated',
    );
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await centreTypeService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Training centre type deleted successfully');
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await centreTypeService.restore(params<IdParams>(req).id, req), 'Training centre type restored (inactive)');
  }),
};
