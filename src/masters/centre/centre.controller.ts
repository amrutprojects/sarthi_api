import type { Request, Response } from 'express';
import { body, params, query } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { centreService } from './centre.service';
import type { CreateCentreBody, ListCentresQuery, UpdateCentreBody } from './centre.validator';

type IdParams = { id: string };

export const centreController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await centreService.list(query<ListCentresQuery>(req));
    ApiResponse.ok(res, page.items, 'Centers retrieved successfully', page.meta);
  }),

  options: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await centreService.options(), 'Centers retrieved successfully');
  }),

  technologyOptions: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await centreService.technologyOptions(), 'Technologies retrieved successfully');
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await centreService.get(params<IdParams>(req).id), 'Center retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await centreService.create(body<CreateCentreBody>(req), req), 'Center created successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      await centreService.update(params<IdParams>(req).id, body<UpdateCentreBody>(req), req),
      'Center updated successfully',
    );
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    ApiResponse.ok(
      res,
      await centreService.setStatus(params<IdParams>(req).id, isActive, req),
      isActive ? 'Center activated' : 'Center deactivated',
    );
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await centreService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Center deleted successfully');
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await centreService.restore(params<IdParams>(req).id, req), 'Center restored (inactive)');
  }),
};
