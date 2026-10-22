import type { Request, Response } from 'express';
import { query } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { referenceService } from './reference.service';
import type {
  ListReferenceCentresQuery, ListReferenceDistrictsQuery, ListReferenceTracksQuery, ReferenceOptionsQuery,
} from './reference.validator';

/* Read-only: every handler is a GET (see reference.routes.ts). */
export const referenceController = {
  summary: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await referenceService.summary(), 'Reference data summary retrieved successfully');
  }),

  districts: asyncHandler(async (req: Request, res: Response) => {
    const page = await referenceService.listDistricts(query<ListReferenceDistrictsQuery>(req));
    ApiResponse.ok(res, page.items, 'Districts retrieved successfully', page.meta);
  }),

  centres: asyncHandler(async (req: Request, res: Response) => {
    const page = await referenceService.listCentres(query<ListReferenceCentresQuery>(req));
    ApiResponse.ok(res, page.items, 'Training centres retrieved successfully', page.meta);
  }),

  tracks: asyncHandler(async (req: Request, res: Response) => {
    const page = await referenceService.listTracks(query<ListReferenceTracksQuery>(req));
    ApiResponse.ok(res, page.items, 'Technology tracks retrieved successfully', page.meta);
  }),

  centreOptions: asyncHandler(async (req: Request, res: Response) => {
    const { entityId } = query<ReferenceOptionsQuery>(req);
    ApiResponse.ok(res, await referenceService.centreOptions(entityId), 'Training centres retrieved successfully');
  }),

  trackOptions: asyncHandler(async (req: Request, res: Response) => {
    const { entityId } = query<ReferenceOptionsQuery>(req);
    ApiResponse.ok(res, await referenceService.trackOptions(entityId), 'Technology tracks retrieved successfully');
  }),
};
