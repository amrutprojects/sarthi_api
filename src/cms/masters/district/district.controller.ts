import type { Request, Response } from 'express';
import { body, params, query } from '../../../middleware/validate-request.middleware';
import { ApiResponse } from '../../../utils/api-response';
import { asyncHandler } from '../../../utils/async-handler';
import { geographyService } from '../geography/geography.service';
import { districtService } from './district.service';
import type { CreateDistrictBody, ListDistrictsQuery, UpdateDistrictBody } from './district.validator';

type IdParams = { id: string };
type DistrictIdParams = { districtId: string };

export const districtController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await districtService.list(query<ListDistrictsQuery>(req));
    ApiResponse.ok(res, page.items, 'Districts retrieved successfully', page.meta);
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await districtService.get(params<IdParams>(req).id), 'District retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await districtService.create(body<CreateDistrictBody>(req), req), 'District created successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await districtService.update(params<IdParams>(req).id, body<UpdateDistrictBody>(req), req), 'District updated successfully');
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    ApiResponse.ok(
      res,
      await districtService.setStatus(params<IdParams>(req).id, isActive, req),
      isActive ? 'District activated' : 'District deactivated',
    );
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await districtService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'District deleted successfully');
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await districtService.restore(params<IdParams>(req).id, req), 'District restored (inactive)');
  }),

  /* Dropdown feed for the Taluka form: the active talukas of one district. */
  talukas: asyncHandler(async (req: Request, res: Response) => {
    const options = await geographyService.talukasOfDistrict(params<DistrictIdParams>(req).districtId);
    ApiResponse.ok(res, options, 'Talukas retrieved successfully');
  }),
};
