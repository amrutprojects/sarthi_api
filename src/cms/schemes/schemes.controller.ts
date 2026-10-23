import type { Request, Response } from 'express';
import { body, params } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { schemesService } from './schemes.service';
import type { CreateSchemeBody, ReorderBody, UpdateSchemeBody, UpdateSectionBody } from './schemes.validator';

type IdParams = { id: string };

export const schemesController = {
  list: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await schemesService.listForAdmin(), 'Schemes retrieved successfully');
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await schemesService.getForAdmin(params<IdParams>(req).id), 'Scheme retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await schemesService.create(body<CreateSchemeBody>(req), req), 'Scheme created successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await schemesService.update(params<IdParams>(req).id, body<UpdateSchemeBody>(req), req);
    ApiResponse.ok(res, data, 'Scheme updated successfully');
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    const data = await schemesService.setActive(params<IdParams>(req).id, isActive, req);
    ApiResponse.ok(res, data, isActive ? 'Scheme shown on the website' : 'Scheme hidden from the website');
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await schemesService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Scheme deleted successfully');
  }),

  reorder: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await schemesService.reorder(body<ReorderBody>(req).ids, req), 'Display order updated successfully');
  }),

  getSection: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await schemesService.getSection(), 'Section settings retrieved successfully');
  }),

  updateSection: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await schemesService.updateSection(body<UpdateSectionBody>(req), req), 'Section settings updated successfully');
  }),

  /*
   * Public read. `null` is a legitimate answer — the section has not been configured — so it is a
   * 200 with no data rather than a 404.
   */
  public: asyncHandler(async (_req: Request, res: Response) => {
    const data = await schemesService.getPublic();
    ApiResponse.ok(res, data, data ? 'AMRUT Schemes retrieved successfully' : 'The AMRUT Schemes section is not configured');
  }),
};
