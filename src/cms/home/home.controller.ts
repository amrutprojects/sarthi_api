import type { Request, Response } from 'express';
import { body } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { homeService } from './home.service';
import type { UpdateHomeGlanceBody } from './home.validator';

export const homeController = {
  get: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await homeService.getForAdmin(), 'Home page figures retrieved successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await homeService.update(body<UpdateHomeGlanceBody>(req), req);
    ApiResponse.ok(res, data, 'Home page figures updated successfully');
  }),
};
