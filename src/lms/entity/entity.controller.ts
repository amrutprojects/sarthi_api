import type { Request, Response } from 'express';
import { body, params, query } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { lmsEntityService } from './entity.service';
import type { CreateLmsEntityBody, ListLmsEntitiesQuery, UpdateLmsEntityBody } from './entity.validator';

type IdParams = { id: string };

export const lmsEntityController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await lmsEntityService.list(query<ListLmsEntitiesQuery>(req));
    ApiResponse.ok(res, page.items, 'Entities retrieved successfully', page.meta);
  }),

  options: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsEntityService.options(), 'Entities retrieved successfully');
  }),

  formOptions: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, lmsEntityService.formOptions(), 'Entity form options retrieved successfully');
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsEntityService.get(params<IdParams>(req).id), 'Entity retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await lmsEntityService.create(body<CreateLmsEntityBody>(req), req), 'Entity created successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      await lmsEntityService.update(params<IdParams>(req).id, body<UpdateLmsEntityBody>(req), req),
      'Entity updated successfully',
    );
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    ApiResponse.ok(res, await lmsEntityService.setStatus(params<IdParams>(req).id, isActive, req), isActive ? 'Entity activated' : 'Entity deactivated');
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await lmsEntityService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Entity deleted successfully');
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsEntityService.restore(params<IdParams>(req).id, req), 'Entity restored (inactive)');
  }),
};
