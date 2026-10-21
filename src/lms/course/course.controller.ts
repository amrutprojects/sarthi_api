import type { Request, Response } from 'express';
import { body, params, query } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../shared/http/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { lmsCourseService } from './course.service';
import type {
  CreateLmsCourseBody, ListLmsCoursesQuery, LmsCourseLanguagesQuery, LmsCourseOptionsQuery, UpdateLmsCourseBody,
} from './course.validator';

type IdParams = { id: string };

export const lmsCourseController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await lmsCourseService.list(query<ListLmsCoursesQuery>(req));
    ApiResponse.ok(res, page.items, 'Courses retrieved successfully', page.meta);
  }),

  options: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsCourseService.options(query<LmsCourseOptionsQuery>(req).entityId), 'Courses retrieved successfully');
  }),

  languages: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      await lmsCourseService.enabledLanguages(query<LmsCourseLanguagesQuery>(req).entityId),
      'Course languages retrieved successfully',
    );
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsCourseService.get(params<IdParams>(req).id), 'Course retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await lmsCourseService.create(body<CreateLmsCourseBody>(req), req), 'Course created successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsCourseService.update(params<IdParams>(req).id, body<UpdateLmsCourseBody>(req), req), 'Course updated successfully');
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    ApiResponse.ok(res, await lmsCourseService.setStatus(params<IdParams>(req).id, isActive, req), isActive ? 'Course activated' : 'Course deactivated');
  }),

  retire: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsCourseService.retire(params<IdParams>(req).id, req), 'Course retired');
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await lmsCourseService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Course deleted successfully');
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsCourseService.restore(params<IdParams>(req).id, req), 'Course restored (inactive)');
  }),
};
