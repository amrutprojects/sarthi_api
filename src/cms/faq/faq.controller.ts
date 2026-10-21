import type { Request, Response } from 'express';
import { body, params, query } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { faqService } from './faq.service';
import type { CreateFaqBody, ListFaqsQuery, UpdateFaqBody } from './faq.validator';

type IdParams = { id: string };

export const faqController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await faqService.list(query<ListFaqsQuery>(req));
    ApiResponse.ok(res, page.items, 'FAQs retrieved successfully', page.meta);
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await faqService.get(params<IdParams>(req).id), 'FAQ retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await faqService.create(body<CreateFaqBody>(req), req), 'FAQ created successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await faqService.update(params<IdParams>(req).id, body<UpdateFaqBody>(req), req), 'FAQ updated successfully');
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    ApiResponse.ok(
      res,
      await faqService.setStatus(params<IdParams>(req).id, isActive, req),
      isActive ? 'FAQ activated' : 'FAQ deactivated',
    );
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await faqService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'FAQ deleted successfully');
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await faqService.restore(params<IdParams>(req).id, req), 'FAQ restored (inactive)');
  }),

  /* Public read: the active questions in display order. An empty list is a normal answer, not a 404. */
  public: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await faqService.getPublic(), 'FAQs retrieved successfully');
  }),
};
