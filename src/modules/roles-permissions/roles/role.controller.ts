import type { Request, Response } from 'express';
import { MESSAGES } from '../../../constants/api-response.constants';
import { body, params, query } from '../../../middleware/validate-request.middleware';
import { roleService } from './role.service';
import { ApiResponse } from '../../../utils/api-response';
import { asyncHandler } from '../../../shared/http/async-handler';
import type { CreateRoleBody, ListRolesQuery, UpdateRoleBody } from './role.validation';

type IdParams = { id: string };
const actor = (req: Request) => req.auth!;

export const roleController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await roleService.list(query<ListRolesQuery>(req));
    ApiResponse.ok(res, page.items, MESSAGES.retrieved('Roles'), page.meta);
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await roleService.get(params<IdParams>(req).id), MESSAGES.retrieved('Role'));
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await roleService.create(body<CreateRoleBody>(req), actor(req), req), MESSAGES.created('Role'));
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await roleService.update(params<IdParams>(req).id, body<UpdateRoleBody>(req), req), MESSAGES.updated('Role'));
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    ApiResponse.ok(
      res,
      await roleService.setStatus(params<IdParams>(req).id, isActive, req),
      isActive ? MESSAGES.activated('Role') : MESSAGES.deactivated('Role'),
    );
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await roleService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, MESSAGES.deleted('Role'));
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await roleService.restore(params<IdParams>(req).id, req), MESSAGES.restored('Role'));
  }),

  getPermissions: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await roleService.getPermissions(params<IdParams>(req).id), MESSAGES.retrieved('Role permissions'));
  }),

  replacePermissions: asyncHandler(async (req: Request, res: Response) => {
    const { permissionIds } = body<{ permissionIds: string[] }>(req);
    const perms = await roleService.replacePermissions(params<IdParams>(req).id, permissionIds, actor(req), req);
    ApiResponse.ok(res, perms, MESSAGES.updated('Role permissions'));
  }),
};
