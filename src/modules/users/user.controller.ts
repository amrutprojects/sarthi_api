import { P } from '../roles-permissions';
import { MESSAGES } from '../../constants/api-response.constants';
import type { Request, Response } from 'express';
import { body, params, query } from '../../middleware/validate-request.middleware';
import { userService } from './user.service';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import type { CreateUserBody, ListUsersQuery, UpdateUserBody } from './user.validation';

type IdParams = { id: string };
const actor = (req: Request) => req.auth!;

export const userController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await userService.list(query<ListUsersQuery>(req), req.auth!.permissions.has(P.ROLES_VIEW));
    ApiResponse.ok(res, page.items, MESSAGES.retrieved('Users'), page.meta);
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await userService.get(params<IdParams>(req).id), MESSAGES.retrieved('User'));
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await userService.create(body<CreateUserBody>(req), actor(req), req), MESSAGES.created('User'));
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const user = await userService.update(params<IdParams>(req).id, body<UpdateUserBody>(req), actor(req), req);
    ApiResponse.ok(res, user, MESSAGES.updated('User'));
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    const user = await userService.setStatus(params<IdParams>(req).id, isActive, actor(req), req);
    ApiResponse.ok(res, user, isActive ? MESSAGES.activated('User') : MESSAGES.deactivated('User'));
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await userService.remove(params<IdParams>(req).id, actor(req), req);
    ApiResponse.ok(res, null, MESSAGES.deleted('User'));
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await userService.restore(params<IdParams>(req).id, req), MESSAGES.restored('User'));
  }),

  getRoles: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await userService.getRoles(params<IdParams>(req).id), MESSAGES.retrieved('User roles'));
  }),

  replaceRoles: asyncHandler(async (req: Request, res: Response) => {
    const { roleIds } = body<{ roleIds: string[] }>(req);
    const roles = await userService.replaceRoles(params<IdParams>(req).id, roleIds, actor(req), req);
    ApiResponse.ok(res, roles, MESSAGES.updated('User roles'));
  }),
};
