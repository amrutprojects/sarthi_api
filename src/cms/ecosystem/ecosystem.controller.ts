import type { Request, Response } from 'express';
import { body, params } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { ecosystemService } from './ecosystem.service';
import type { CreateProgrammeBody, ReorderBody, UpdateProgrammeBody, UpdateSectionBody } from './ecosystem.validator';

type IdParams = { id: string };

export const ecosystemController = {
  list: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await ecosystemService.listForAdmin(), 'Programmes retrieved successfully');
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await ecosystemService.getForAdmin(params<IdParams>(req).id), 'Programme retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await ecosystemService.create(body<CreateProgrammeBody>(req), req), 'Programme created successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await ecosystemService.update(params<IdParams>(req).id, body<UpdateProgrammeBody>(req), req);
    ApiResponse.ok(res, data, 'Programme updated successfully');
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    const data = await ecosystemService.setActive(params<IdParams>(req).id, isActive, req);
    ApiResponse.ok(res, data, isActive ? 'Programme shown on the website' : 'Programme hidden from the website');
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await ecosystemService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Programme deleted successfully');
  }),

  reorder: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await ecosystemService.reorder(body<ReorderBody>(req).ids, req), 'Display order updated successfully');
  }),

  getSection: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await ecosystemService.getSection(), 'Section settings retrieved successfully');
  }),

  updateSection: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await ecosystemService.updateSection(body<UpdateSectionBody>(req), req), 'Section settings updated successfully');
  }),

  /*
   * Public read. `null` is a legitimate answer — the section has not been configured — so it is a
   * 200 with no data rather than a 404.
   */
  public: asyncHandler(async (_req: Request, res: Response) => {
    const data = await ecosystemService.getPublic();
    ApiResponse.ok(res, data, data ? 'AMRUT Ecosystem retrieved successfully' : 'The AMRUT Ecosystem section is not configured');
  }),
};
