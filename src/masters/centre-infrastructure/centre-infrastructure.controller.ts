import type { Request, Response } from 'express';
import { body, params, query } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { centreInfrastructureService } from './centre-infrastructure.service';
import type {
  CentreInfrastructureSummaryQuery, CreateCentreInfrastructureBody, ListCentreInfrastructureQuery, UpdateCentreInfrastructureBody,
} from './centre-infrastructure.validator';

type IdParams = { id: string };

export const centreInfrastructureController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await centreInfrastructureService.list(query<ListCentreInfrastructureQuery>(req));
    ApiResponse.ok(res, page.items, 'Capacity and infrastructure details retrieved successfully', page.meta);
  }),

  summary: asyncHandler(async (req: Request, res: Response) => {
    const { centreId } = query<CentreInfrastructureSummaryQuery>(req);
    ApiResponse.ok(res, await centreInfrastructureService.summary(centreId), 'Capacity and infrastructure summary retrieved successfully');
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      await centreInfrastructureService.get(params<IdParams>(req).id),
      'Capacity and infrastructure details retrieved successfully',
    );
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(
      res,
      await centreInfrastructureService.create(body<CreateCentreInfrastructureBody>(req), req),
      'Capacity and infrastructure details created successfully',
    );
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      await centreInfrastructureService.update(params<IdParams>(req).id, body<UpdateCentreInfrastructureBody>(req), req),
      'Capacity and infrastructure details updated successfully',
    );
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    ApiResponse.ok(
      res,
      await centreInfrastructureService.setStatus(params<IdParams>(req).id, isActive, req),
      isActive ? 'Capacity and infrastructure details activated' : 'Capacity and infrastructure details deactivated',
    );
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await centreInfrastructureService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Capacity and infrastructure details deleted successfully');
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      await centreInfrastructureService.restore(params<IdParams>(req).id, req),
      'Capacity and infrastructure details restored (inactive)',
    );
  }),
};
