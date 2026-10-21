import type { Request, Response } from 'express';
import { body } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { programmeService } from './programme.service';
import type { ProgrammeStatusBody, UpdateProgrammePageBody } from './programme.validator';

export const programmeController = {
  /* Admin read: the whole page, including when unpublished. */
  get: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await programmeService.getForAdmin(), 'Programme page retrieved successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await programmeService.update(body<UpdateProgrammePageBody>(req), req);
    ApiResponse.ok(res, data, 'Programme page updated successfully');
  }),

  setPublished: asyncHandler(async (req: Request, res: Response) => {
    const { isPublished } = body<ProgrammeStatusBody>(req);
    const data = await programmeService.setPublished(isPublished, req);
    ApiResponse.ok(res, data, isPublished ? 'Programme page published' : 'Programme page unpublished');
  }),

  /* Public read. `null` (unpublished / not configured) is a 200, not a 404: the website then shows its bundled copy. */
  public: asyncHandler(async (_req: Request, res: Response) => {
    const data = await programmeService.getPublic();
    ApiResponse.ok(res, data, data ? 'Programme page retrieved successfully' : 'Programme page is not published');
  }),
};
