import type { Request, Response } from 'express';
import { body, params, query } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../shared/http/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { trackVariantItemsService, type ItemKindName } from './track-variant-items.service';
import { lmsTrackVariantService } from './track-variant.service';
import type { CreateTrackVariantBody, ListTrackVariantsQuery, UpdateTrackVariantBody } from './track-variant.validator';

type IdParams = { id: string };
type ItemParams = { id: string; itemId: string };

export const lmsTrackVariantController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await lmsTrackVariantService.list(query<ListTrackVariantsQuery>(req));
    ApiResponse.ok(res, page.items, 'Track variants retrieved successfully', page.meta);
  }),

  options: asyncHandler(async (req: Request, res: Response) => {
    const { courseModuleId } = query<{ courseModuleId?: string }>(req);
    ApiResponse.ok(res, await lmsTrackVariantService.options(courseModuleId), 'Track variants retrieved successfully');
  }),

  formOptions: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, lmsTrackVariantService.formOptions(), 'Track variant form options retrieved successfully');
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsTrackVariantService.get(params<IdParams>(req).id), 'Track variant retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await lmsTrackVariantService.create(body<CreateTrackVariantBody>(req), req), 'Track variant created successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      await lmsTrackVariantService.update(params<IdParams>(req).id, body<UpdateTrackVariantBody>(req), req),
      'Track variant updated successfully',
    );
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    ApiResponse.ok(
      res,
      await lmsTrackVariantService.setStatus(params<IdParams>(req).id, isActive, req),
      isActive ? 'Track variant activated' : 'Track variant deactivated',
    );
  }),

  publish: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsTrackVariantService.publish(params<IdParams>(req).id, req), 'Track variant published');
  }),

  retire: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsTrackVariantService.retire(params<IdParams>(req).id, req), 'Track variant retired');
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await lmsTrackVariantService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Track variant deleted successfully');
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsTrackVariantService.restore(params<IdParams>(req).id, req), 'Track variant restored (inactive)');
  }),

  retireOftCard: asyncHandler(async (req: Request, res: Response) => {
    const p = params<ItemParams>(req);
    ApiResponse.ok(res, await trackVariantItemsService.retireOftCard(p.id, p.itemId, req), 'OFT card retired');
  }),
};

/* The nested curriculum routes, one handler set per item kind (track-variant-items.service.ts). */
export const itemController = (kind: ItemKindName, label: string) => ({
  list: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await trackVariantItemsService.list(kind, params<IdParams>(req).id), `${label} retrieved successfully`);
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    const p = params<ItemParams>(req);
    ApiResponse.ok(res, await trackVariantItemsService.get(kind, p.id, p.itemId), `${label} retrieved successfully`);
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const item = await trackVariantItemsService.create(kind, params<IdParams>(req).id, body<Record<string, unknown>>(req), req);
    ApiResponse.created(res, item, `${label} created successfully`);
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const p = params<ItemParams>(req);
    const item = await trackVariantItemsService.update(kind, p.id, p.itemId, body<Record<string, unknown>>(req), req);
    ApiResponse.ok(res, item, `${label} updated successfully`);
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    const p = params<ItemParams>(req);
    await trackVariantItemsService.remove(kind, p.id, p.itemId, req);
    ApiResponse.ok(res, null, `${label} deleted successfully`);
  }),
});
