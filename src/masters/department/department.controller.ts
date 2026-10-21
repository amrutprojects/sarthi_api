import type { Request, Response } from 'express';
import { body, params, query } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { departmentService } from './department.service';
import type { CreateDepartmentBody, ListDepartmentsQuery, UpdateDepartmentBody } from './department.validator';

type IdParams = { id: string };

export const departmentController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await departmentService.list(query<ListDepartmentsQuery>(req));
    ApiResponse.ok(res, page.items, 'Departments retrieved successfully', page.meta);
  }),

  options: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await departmentService.options(), 'Departments retrieved successfully');
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await departmentService.get(params<IdParams>(req).id), 'Department retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await departmentService.create(body<CreateDepartmentBody>(req), req), 'Department created successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      await departmentService.update(params<IdParams>(req).id, body<UpdateDepartmentBody>(req), req),
      'Department updated successfully',
    );
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    ApiResponse.ok(
      res,
      await departmentService.setStatus(params<IdParams>(req).id, isActive, req),
      isActive ? 'Department activated' : 'Department deactivated',
    );
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await departmentService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Department deleted successfully');
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await departmentService.restore(params<IdParams>(req).id, req), 'Department restored (inactive)');
  }),
};
