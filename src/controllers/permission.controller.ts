import type { Request, Response } from 'express';
import { body, params, query } from '../middleware/validate-request.middleware';
import { permissionService } from '../services/permission.service';
import { ApiResponse } from '../utils/api-response';
import { asyncHandler } from '../utils/async-handler';
import type { CreatePermissionBody, ListPermissionsQuery, UpdatePermissionBody } from '../validators/permission.validator';

type IdParams = { id: string };

export const permissionController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await permissionService.list(query<ListPermissionsQuery>(req));
    ApiResponse.ok(res, page.items, 'Permissions retrieved successfully', page.meta);
  }),

  modules: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await permissionService.modules(), 'Permission modules retrieved successfully');
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await permissionService.get(params<IdParams>(req).id), 'Permission retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await permissionService.create(body<CreatePermissionBody>(req), req), 'Permission created successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await permissionService.update(params<IdParams>(req).id, body<UpdatePermissionBody>(req), req), 'Permission updated successfully');
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    ApiResponse.ok(res, await permissionService.setStatus(params<IdParams>(req).id, isActive, req), isActive ? 'Permission activated' : 'Permission deactivated');
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await permissionService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Permission deleted successfully');
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await permissionService.restore(params<IdParams>(req).id, req), 'Permission restored (inactive)');
  }),
};
