import { Router } from 'express';
import { z } from 'zod';
import { P } from '../permission.constants';
import { authenticate } from '../../../middleware/authenticate.middleware';
import { authorizePermission } from '../../../middleware/authorize-permission.middleware';
import { body, validateRequest } from '../../../middleware/validate-request.middleware';
import { menuVisibilityService, type MenuVisibilityChange } from './menu-visibility.service';
import { ApiResponse } from '../../../shared/http/api-response';
import { asyncHandler } from '../../../shared/http/async-handler';

const updateSchema = {
  body: z.object({
    changes: z.array(z.object({ roleId: z.string().uuid(), menuKey: z.string().min(1).max(64), visible: z.boolean() }).strict())
      .min(1).max(2000),
  }).strict(),
};

export const menuVisibilityRouter = Router();
menuVisibilityRouter.use(authenticate);

menuVisibilityRouter.get('/', authorizePermission(P.ROLES_VIEW), asyncHandler(async (_req, res) => {
  ApiResponse.ok(res, await menuVisibilityService.matrix(), 'Menu visibility retrieved');
}));

menuVisibilityRouter.put('/', authorizePermission(P.ROLES_UPDATE), validateRequest(updateSchema), asyncHandler(async (req, res) => {
  const { changes } = body<{ changes: MenuVisibilityChange[] }>(req);
  ApiResponse.ok(res, await menuVisibilityService.apply(changes, req), 'Menu visibility updated');
}));
