import type { Request, Response } from 'express';
import { params } from '../../../middleware/validate-request.middleware';
import { ApiResponse } from '../../../utils/api-response';
import { asyncHandler } from '../../../shared/http/async-handler';
import { geographyService } from './geography.service';

export const geographyController = {
  states: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await geographyService.states(), 'States retrieved successfully');
  }),

  districtsOfState: asyncHandler(async (req: Request, res: Response) => {
    const { stateId } = params<{ stateId: string }>(req);
    ApiResponse.ok(res, await geographyService.districtsOfState(stateId), 'Districts retrieved successfully');
  }),

  talukasOfDistrict: asyncHandler(async (req: Request, res: Response) => {
    const { districtId } = params<{ districtId: string }>(req);
    ApiResponse.ok(res, await geographyService.talukasOfDistrict(districtId), 'Talukas retrieved successfully');
  }),
};
