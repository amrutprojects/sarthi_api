import type { Request, Response } from 'express';
import { body } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { brandBarService } from './brandbar.service';
import type { UpdateBrandBarBody } from './brandbar.validator';

export const brandBarController = {
  get: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await brandBarService.get(), 'Brand Bar retrieved successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await brandBarService.update(body<UpdateBrandBarBody>(req), req), 'Brand Bar updated successfully');
  }),

  /*
   * Public read. `null` is a legitimate answer — the Brand Bar has not been configured — so it is a
   * 200 with no data rather than a 404.
   */
  public: asyncHandler(async (_req: Request, res: Response) => {
    const data = await brandBarService.getPublic();
    ApiResponse.ok(res, data, data ? 'Brand Bar retrieved successfully' : 'The Brand Bar is not configured');
  }),
};
