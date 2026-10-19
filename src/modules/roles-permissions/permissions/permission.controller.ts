import type { Request, Response } from 'express';
import { MESSAGES } from '../../../constants/api-response.constants';
import { body, params, query } from '../../../middleware/validate-request.middleware';
import { permissionService } from './permission.service';
import { ApiResponse } from '../../../utils/api-response';
import { asyncHandler } from '../../../shared/http/async-handler';
import type { CreatePermissionBody, ListPermissionsQuery, UpdatePermissionBody } from './permission.validation';

type IdParams = { id: string };

export const permissionController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await permissionService.list(query<ListPermissionsQuery>(req));
    ApiResponse.ok(res, page.items, MESSAGES.retrieved('Permissions'), page.meta);
  }),

  modules: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await permissionService.modules(), MESSAGES.retrieved('Permission modules'));
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await permissionService.get(params<IdParams>(req).id), MESSAGES.retrieved('Permission'));
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await permissionService.create(body<CreatePermissionBody>(req), req), MESSAGES.created('Permission'));
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      await permissionService.update(params<IdParams>(req).id, body<UpdatePermissionBody>(req), req),
      MESSAGES.updated('Permission'),
    );
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    ApiResponse.ok(
      res,
      await permissionService.setStatus(params<IdParams>(req).id, isActive, req),
      isActive ? MESSAGES.activated('Permission') : MESSAGES.deactivated('Permission'),
    );
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await permissionService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, MESSAGES.deleted('Permission'));
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await permissionService.restore(params<IdParams>(req).id, req), MESSAGES.restored('Permission'));
  }),
};
