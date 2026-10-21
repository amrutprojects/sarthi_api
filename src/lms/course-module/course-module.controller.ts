import type { Request, Response } from 'express';
import { body, params, query } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../shared/http/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { lmsCourseModuleService } from './course-module.service';
import type {
  CreateLmsCourseModuleBody, CreatePrescribedModulesBody, ListLmsCourseModulesQuery, LmsCourseModuleOptionsQuery, UpdateLmsCourseModuleBody,
} from './course-module.validator';

type IdParams = { id: string };

export const lmsCourseModuleController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await lmsCourseModuleService.list(query<ListLmsCourseModulesQuery>(req));
    ApiResponse.ok(res, page.items, 'Modules retrieved successfully', page.meta);
  }),

  options: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsCourseModuleService.options(query<LmsCourseModuleOptionsQuery>(req)), 'Modules retrieved successfully');
  }),

  prescribed: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, lmsCourseModuleService.prescribed(), 'Prescribed modules retrieved successfully');
  }),

  createPrescribed: asyncHandler(async (req: Request, res: Response) => {
    const { courseId, syllabusRef } = body<CreatePrescribedModulesBody>(req);
    const result = await lmsCourseModuleService.createPrescribed(courseId, syllabusRef, req);
    if (result.created.length) ApiResponse.created(res, result, 'Prescribed modules created successfully');
    else ApiResponse.ok(res, result, 'The course already has its four modules');
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsCourseModuleService.get(params<IdParams>(req).id), 'Module retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await lmsCourseModuleService.create(body<CreateLmsCourseModuleBody>(req), req), 'Module created successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      await lmsCourseModuleService.update(params<IdParams>(req).id, body<UpdateLmsCourseModuleBody>(req), req),
      'Module updated successfully',
    );
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    ApiResponse.ok(res, await lmsCourseModuleService.setStatus(params<IdParams>(req).id, isActive, req), isActive ? 'Module activated' : 'Module deactivated');
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await lmsCourseModuleService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Module deleted successfully');
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsCourseModuleService.restore(params<IdParams>(req).id, req), 'Module restored (inactive)');
  }),
};
