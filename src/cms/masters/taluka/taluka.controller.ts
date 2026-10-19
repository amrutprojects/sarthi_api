import type { Request, Response } from 'express';
import { body, params, query } from '../../../middleware/validate-request.middleware';
import { ApiResponse } from '../../../utils/api-response';
import { asyncHandler } from '../../../utils/async-handler';
import { talukaService } from './taluka.service';
import type { CreateTalukaBody, ListTalukasQuery, UpdateTalukaBody } from './taluka.validator';

type IdParams = { id: string };

export const talukaController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await talukaService.list(query<ListTalukasQuery>(req));
    ApiResponse.ok(res, page.items, 'Talukas retrieved successfully', page.meta);
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await talukaService.get(params<IdParams>(req).id), 'Taluka retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await talukaService.create(body<CreateTalukaBody>(req), req), 'Taluka created successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await talukaService.update(params<IdParams>(req).id, body<UpdateTalukaBody>(req), req), 'Taluka updated successfully');
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    ApiResponse.ok(
      res,
      await talukaService.setStatus(params<IdParams>(req).id, isActive, req),
      isActive ? 'Taluka activated' : 'Taluka deactivated',
    );
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await talukaService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Taluka deleted successfully');
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await talukaService.restore(params<IdParams>(req).id, req), 'Taluka restored (inactive)');
  }),
};
