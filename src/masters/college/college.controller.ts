import type { Request, Response } from 'express';
import { body, params, query } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { collegeService } from './college.service';
import type { CreateCollegeBody, ListCollegesQuery, UpdateCollegeBody } from './college.validator';

type IdParams = { id: string };

export const collegeController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await collegeService.list(query<ListCollegesQuery>(req));
    ApiResponse.ok(res, page.items, 'Colleges retrieved successfully', page.meta);
  }),

  options: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await collegeService.options(), 'Colleges retrieved successfully');
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await collegeService.get(params<IdParams>(req).id), 'College retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await collegeService.create(body<CreateCollegeBody>(req), req), 'College created successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await collegeService.update(params<IdParams>(req).id, body<UpdateCollegeBody>(req), req), 'College updated successfully');
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    ApiResponse.ok(
      res,
      await collegeService.setStatus(params<IdParams>(req).id, isActive, req),
      isActive ? 'College activated' : 'College deactivated',
    );
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await collegeService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'College deleted successfully');
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await collegeService.restore(params<IdParams>(req).id, req), 'College restored (inactive)');
  }),
};
