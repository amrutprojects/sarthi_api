import type { Request, Response } from 'express';
import { body } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { modulesService } from './modules.service';
import type { UpdateModulesPageBody } from './modules.validator';

export const modulesController = {
  /* Admin read: the whole page, including inactive rows. */
  get: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await modulesService.getForAdmin(), 'Modules page retrieved successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await modulesService.update(body<UpdateModulesPageBody>(req), req);
    ApiResponse.ok(res, data, 'Modules page updated successfully');
  }),

  /*
   * Public read. `null` is a legitimate answer — the page has not been configured yet (no active
   * settings row) — so it is a 200 with no data rather than a 404: the website treats it as "show
   * the bundled copy", which is not an error condition.
   */
  public: asyncHandler(async (_req: Request, res: Response) => {
    const data = await modulesService.getPublic();
    ApiResponse.ok(res, data, data ? 'Modules page retrieved successfully' : 'Modules page is not configured');
  }),
};
