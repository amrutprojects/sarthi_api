import type { Request, Response } from 'express';
import { body } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { heroService } from './hero.service';
import type { HeroStatusBody, UpdateHeroBody } from './hero.validator';

export const heroController = {
  get: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await heroService.getForAdmin(), 'Home hero section retrieved successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await heroService.update(body<UpdateHeroBody>(req), req);
    ApiResponse.ok(res, data, 'Home hero section updated successfully');
  }),

  setPublished: asyncHandler(async (req: Request, res: Response) => {
    const { isPublished } = body<HeroStatusBody>(req);
    const data = await heroService.setPublished(isPublished, req);
    ApiResponse.ok(res, data, isPublished ? 'Home hero section published' : 'Home hero section unpublished');
  }),

  /*
   * Public read. `null` is a legitimate answer — unpublished or not yet configured — so it is a
   * 200 with no data rather than a 404: the website treats it as "show the bundled copy".
   */
  public: asyncHandler(async (_req: Request, res: Response) => {
    const data = await heroService.getPublic();
    ApiResponse.ok(res, data, data ? 'Home hero section retrieved successfully' : 'Home hero section is not published');
  }),
};
