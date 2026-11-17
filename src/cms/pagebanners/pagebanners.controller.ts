import type { Request, Response } from 'express';
import { body, params } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { pageBannerService } from './pagebanners.service';
import type { PageBannerKeyParams, UpdatePageBannerBody } from './pagebanners.validator';

export const pageBannerController = {
  list: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await pageBannerService.list(), 'Page banners retrieved successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const { title, subtitle } = body<UpdatePageBannerBody>(req);
    const data = await pageBannerService.set(params<PageBannerKeyParams>(req).key, { title, subtitle }, req);
    ApiResponse.ok(res, data, data.title || data.subtitle ? 'Page banner saved' : 'Page banner reset to the default');
  }),

  public: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await pageBannerService.getPublic(), 'Page banners retrieved successfully');
  }),
};
