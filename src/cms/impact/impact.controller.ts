import type { Request, Response } from 'express';
import { body, params } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { impactService } from './impact.service';
import type { CreateImpactStatBody, ReorderBody, UpdateImpactStatBody, UpdateSectionBody } from './impact.validator';

type IdParams = { id: string };

export const impactController = {
  list: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await impactService.listForAdmin(), 'Impact cards retrieved successfully');
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await impactService.getForAdmin(params<IdParams>(req).id), 'Impact card retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await impactService.create(body<CreateImpactStatBody>(req), req), 'Impact card created successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await impactService.update(params<IdParams>(req).id, body<UpdateImpactStatBody>(req), req);
    ApiResponse.ok(res, data, 'Impact card updated successfully');
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    const data = await impactService.setActive(params<IdParams>(req).id, isActive, req);
    ApiResponse.ok(res, data, isActive ? 'Impact card shown on the website' : 'Impact card hidden from the website');
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await impactService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Impact card deleted successfully');
  }),

  reorder: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await impactService.reorder(body<ReorderBody>(req).ids, req), 'Display order updated successfully');
  }),

  getSection: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await impactService.getSection(), 'Section settings retrieved successfully');
  }),

  updateSection: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await impactService.updateSection(body<UpdateSectionBody>(req), req), 'Section settings updated successfully');
  }),

  /*
   * Public read. `null` is a legitimate answer — the section has not been configured — so it is a
   * 200 with no data rather than a 404.
   */
  public: asyncHandler(async (_req: Request, res: Response) => {
    const data = await impactService.getPublic();
    ApiResponse.ok(res, data, data ? "AMRUT's Impact retrieved successfully" : "The AMRUT's Impact section is not configured");
  }),
};
