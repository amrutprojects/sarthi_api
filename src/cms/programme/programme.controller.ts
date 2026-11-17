import type { Request, Response } from 'express';
import { body, params } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { programmeService } from './programme.service';
import type { ProgrammeFactParams, ProgrammeFactVisibilityBody, ProgrammeStatusBody, UpdateProgrammePageBody } from './programme.validator';

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

  /* One fact sheet row's switch. Returns the whole admin page, so the screen refreshes from the response. */
  setFactVisibility: asyncHandler(async (req: Request, res: Response) => {
    const { show } = body<ProgrammeFactVisibilityBody>(req);
    const data = await programmeService.setFactVisibility(params<ProgrammeFactParams>(req).key, show, req);
    ApiResponse.ok(res, data, show ? 'Fact shown on the website' : 'Fact hidden from the website');
  }),

  /* Public read. `null` (unpublished / not configured) is a 200, not a 404: the website then shows its bundled copy. */
  public: asyncHandler(async (_req: Request, res: Response) => {
    const data = await programmeService.getPublic();
    ApiResponse.ok(res, data, data ? 'Programme page retrieved successfully' : 'Programme page is not published');
  }),
};
