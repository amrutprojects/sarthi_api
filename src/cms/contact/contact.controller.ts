import type { Request, Response } from 'express';
import { body } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../utils/async-handler';
import { contactService } from './contact.service';
import type { ContactStatusBody, UpdateContactPageBody } from './contact.validator';

export const contactController = {
  /* Admin read: the whole configuration, including unpublished and inactive cards. */
  get: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await contactService.getForAdmin(), 'Contact page settings retrieved successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await contactService.update(body<UpdateContactPageBody>(req), req);
    ApiResponse.ok(res, data, 'Contact page updated successfully');
  }),

  setPublished: asyncHandler(async (req: Request, res: Response) => {
    const { isPublished } = body<ContactStatusBody>(req);
    const data = await contactService.setPublished(isPublished, req);
    ApiResponse.ok(res, data, isPublished ? 'Contact page published' : 'Contact page unpublished');
  }),

  /*
   * Public read. `null` is a legitimate answer — the page is unpublished or not yet configured — so
   * it is a 200 with no data rather than a 404: the website treats it as "show the bundled copy",
   * which is not an error condition.
   */
  public: asyncHandler(async (_req: Request, res: Response) => {
    const data = await contactService.getPublic();
    ApiResponse.ok(res, data, data ? 'Contact page retrieved successfully' : 'Contact page is not published');
  }),
};
