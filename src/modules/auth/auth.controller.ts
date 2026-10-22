import { menuVisibilityService, rbacService } from '../roles-permissions';
import { MESSAGES, RESPONSE_MESSAGES } from '../../constants/api-response.constants';
import type { Request, Response } from 'express';
import { body } from '../../middleware/validate-request.middleware';
import { authService } from './auth.service';
import { clearSessionCookie, csrfTokenFor, setSessionCookie, wantsBearerToken } from './session';
import { userService } from '../users';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import type { LoginBody } from './auth.validation';

const authOf = (req: Request) => req.auth!; // routes using these handlers run authenticate() first

export const authController = {
  login: asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = body<LoginBody>(req);
    const { payload, accessToken, ...result } = await authService.login(email, password, req);
    res.setHeader('Cache-Control', 'no-store');
    /* Browsers get the token only as an HttpOnly cookie; API clients that ask (X-Auth-Mode: bearer) get it in the body. */
    setSessionCookie(res, accessToken, payload.exp);
    ApiResponse.ok(res, wantsBearerToken(req) ? { accessToken, ...result } : result, RESPONSE_MESSAGES.LOGIN_SUCCESS);
  }),

  logout: asyncHandler(async (req: Request, res: Response) => {
    await authService.logout(authOf(req), req);
    clearSessionCookie(res);
    ApiResponse.ok(res, null, RESPONSE_MESSAGES.LOGOUT_SUCCESS);
  }),

  me: asyncHandler(async (req: Request, res: Response) => {
    const auth = authOf(req);
    const user = await userService.get(auth.id);
    const hiddenMenus = await menuVisibilityService.hiddenMenusFor(auth.roleCodes);
    const portal = rbacService.portalOf((user.roles ?? []).map((r) => r.code));
    res.setHeader('Cache-Control', 'no-store');
    ApiResponse.ok(
      res,
      { ...user, permissions: [...auth.permissions].sort(), hiddenMenus, portal, csrfToken: csrfTokenFor(auth.sessionId) },
      MESSAGES.retrieved('Current user'),
    );
  }),

  permissions: asyncHandler(async (req: Request, res: Response) => {
    const auth = authOf(req);
    ApiResponse.ok(res, { roles: auth.roleCodes, permissions: [...auth.permissions].sort() }, MESSAGES.retrieved('Effective permissions'));
  }),
};
