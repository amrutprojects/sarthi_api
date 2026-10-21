import type { Request, Response } from 'express';
import { body, params, query } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../shared/http/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { trainingCentreService } from './training-centre.service';
import type { CreateTrainingCentreBody, ListTrainingCentresQuery, UpdateTrainingCentreBody } from './training-centre.validator';

type IdParams = { id: string };

export const trainingCentreController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await trainingCentreService.list(query<ListTrainingCentresQuery>(req));
    ApiResponse.ok(res, page.items, 'Training centres retrieved successfully', page.meta);
  }),

  options: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await trainingCentreService.options(), 'Training centres retrieved successfully');
  }),

  codeSuggestions: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, trainingCentreService.codeSuggestions(), 'Centre code suggestions retrieved successfully');
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await trainingCentreService.get(params<IdParams>(req).id), 'Training centre retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(
      res,
      await trainingCentreService.create(body<CreateTrainingCentreBody>(req), req),
      'Training centre created successfully',
    );
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      await trainingCentreService.update(params<IdParams>(req).id, body<UpdateTrainingCentreBody>(req), req),
      'Training centre updated successfully',
    );
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    ApiResponse.ok(
      res,
      await trainingCentreService.setStatus(params<IdParams>(req).id, isActive, req),
      isActive ? 'Training centre activated' : 'Training centre deactivated',
    );
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await trainingCentreService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Training centre deleted successfully');
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await trainingCentreService.restore(params<IdParams>(req).id, req), 'Training centre restored (inactive)');
  }),
};
