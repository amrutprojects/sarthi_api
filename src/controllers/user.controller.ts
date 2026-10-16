import { P } from '../constants/permission.constants';
import type { Request, Response } from 'express';
import { body, params, query } from '../middleware/validate-request.middleware';
import { userService } from '../services/user.service';
import { ApiResponse } from '../utils/api-response';
import { asyncHandler } from '../utils/async-handler';
import type { CreateUserBody, ListUsersQuery, UpdateUserBody } from '../validators/user.validator';

type IdParams = { id: string };
const actor = (req: Request) => req.auth!;

export const userController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await userService.list(query<ListUsersQuery>(req), req.auth!.permissions.has(P.ROLES_VIEW));
    ApiResponse.ok(res, page.items, 'Users retrieved successfully', page.meta);
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await userService.get(params<IdParams>(req).id), 'User retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await userService.create(body<CreateUserBody>(req), actor(req), req), 'User created successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const user = await userService.update(params<IdParams>(req).id, body<UpdateUserBody>(req), actor(req), req);
    ApiResponse.ok(res, user, 'User updated successfully');
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    const user = await userService.setStatus(params<IdParams>(req).id, isActive, actor(req), req);
    ApiResponse.ok(res, user, isActive ? 'User activated' : 'User deactivated');
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await userService.remove(params<IdParams>(req).id, actor(req), req);
    ApiResponse.ok(res, null, 'User deleted successfully');
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await userService.restore(params<IdParams>(req).id, req), 'User restored (inactive)');
  }),

  getRoles: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await userService.getRoles(params<IdParams>(req).id), 'User roles retrieved successfully');
  }),

  replaceRoles: asyncHandler(async (req: Request, res: Response) => {
    const { roleIds } = body<{ roleIds: string[] }>(req);
    const roles = await userService.replaceRoles(params<IdParams>(req).id, roleIds, actor(req), req);
    ApiResponse.ok(res, roles, 'User roles updated successfully');
  }),
};
