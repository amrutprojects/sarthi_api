import { menuVisibilityService } from '../roles-permissions';
import type { Request, Response } from 'express';
import { body } from '../../middleware/validate-request.middleware';
import { authService } from './auth.service';
import { userService } from '../users';
import { ApiResponse } from '../../shared/http/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import type { LoginBody } from './auth.validation';

const authOf = (req: Request) => req.auth!; // routes using these handlers run authenticate() first

export const authController = {
  login: asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = body<LoginBody>(req);
    const result = await authService.login(email, password, req);
    res.setHeader('Cache-Control', 'no-store');
    ApiResponse.ok(res, result, 'Login successful');
  }),

  logout: asyncHandler(async (req: Request, res: Response) => {
    await authService.logout(authOf(req), req);
    ApiResponse.ok(res, null, 'Logged out');
  }),

  me: asyncHandler(async (req: Request, res: Response) => {
    const auth = authOf(req);
    const user = await userService.get(auth.id);
    const hiddenMenus = await menuVisibilityService.hiddenMenusFor(auth.roleCodes);
    ApiResponse.ok(res, { ...user, permissions: [...auth.permissions].sort(), hiddenMenus }, 'Current user');
  }),

  permissions: asyncHandler(async (req: Request, res: Response) => {
    const auth = authOf(req);
    ApiResponse.ok(res, { roles: auth.roleCodes, permissions: [...auth.permissions].sort() }, 'Effective permissions');
  }),
};
