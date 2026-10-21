import type { Request, Response } from 'express';
import { body } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { footerService } from './footer.service';
import type { FooterStatusBody, UpdateFooterBody } from './footer.validator';

export const footerController = {
  /* Admin read: the whole footer, including unpublished and inactive columns and links. */
  get: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await footerService.getForAdmin(), 'Footer settings retrieved successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await footerService.update(body<UpdateFooterBody>(req), req);
    ApiResponse.ok(res, data, 'Footer updated successfully');
  }),

  setPublished: asyncHandler(async (req: Request, res: Response) => {
    const { isPublished } = body<FooterStatusBody>(req);
    const data = await footerService.setPublished(isPublished, req);
    ApiResponse.ok(res, data, isPublished ? 'Footer published' : 'Footer unpublished');
  }),

  /*
   * Public read. `null` is a legitimate answer — the footer is unpublished or not yet configured —
   * so it is a 200 with no data rather than a 404: the website treats it as "show the bundled
   * copy", which is not an error condition.
   */
  public: asyncHandler(async (_req: Request, res: Response) => {
    const data = await footerService.getPublic();
    ApiResponse.ok(res, data, data ? 'Footer retrieved successfully' : 'Footer is not published');
  }),
};
