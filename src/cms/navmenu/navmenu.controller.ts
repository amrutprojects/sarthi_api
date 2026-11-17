import type { Request, Response } from 'express';
import { body, params } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { navMenuService } from './navmenu.service';
import type { NavMenuKeyParams, UpdateNavMenuItemBody } from './navmenu.validator';

export const navMenuController = {
  list: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await navMenuService.list(), 'Navigation menu retrieved successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const { show, label } = body<UpdateNavMenuItemBody>(req);
    const data = await navMenuService.set(params<NavMenuKeyParams>(req).key, { show, label }, req);
    const message =
      label === undefined
        ? show
          ? 'Menu item shown on the website'
          : 'Menu item hidden from the website'
        : show === undefined
          ? data.label
            ? 'Menu item name saved'
            : 'Menu item name reset to the default'
          : 'Menu item updated';
    ApiResponse.ok(res, data, message);
  }),

  public: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await navMenuService.getPublic(), 'Navigation menu retrieved successfully');
  }),
};
