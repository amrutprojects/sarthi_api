import type { Request, Response } from 'express';
import { MESSAGES } from '../../constants/api-response.constants';
import { body, params, query } from '../../middleware/validate-request.middleware';
import { asyncHandler } from '../../shared/http/async-handler';
import type { ListQuery } from '../../shared/utils/pagination';
import { ApiResponse } from '../../utils/api-response';
import type { MasterService } from './master.service';
import type { MasterInput, MasterSortField } from './master.validation';

type IdParams = { id: string };

export function masterController(service: MasterService) {
  const { label, plural } = service.def;
  return {
    list: asyncHandler(async (req: Request, res: Response) => {
      const page = await service.list(query<ListQuery<MasterSortField>>(req));
      ApiResponse.ok(res, page.items, MESSAGES.retrieved(plural), page.meta);
    }),

    options: asyncHandler(async (_req: Request, res: Response) => {
      ApiResponse.ok(res, await service.options(), MESSAGES.retrieved(plural));
    }),

    get: asyncHandler(async (req: Request, res: Response) => {
      ApiResponse.ok(res, await service.get(params<IdParams>(req).id), MESSAGES.retrieved(label));
    }),

    create: asyncHandler(async (req: Request, res: Response) => {
      ApiResponse.created(res, await service.create(body<MasterInput>(req), req), MESSAGES.created(label));
    }),

    update: asyncHandler(async (req: Request, res: Response) => {
      ApiResponse.ok(res, await service.update(params<IdParams>(req).id, body<MasterInput>(req), req), MESSAGES.updated(label));
    }),

    setStatus: asyncHandler(async (req: Request, res: Response) => {
      const { isActive } = body<{ isActive: boolean }>(req);
      const dto = await service.setStatus(params<IdParams>(req).id, isActive, req);
      ApiResponse.ok(res, dto, isActive ? MESSAGES.activated(label) : MESSAGES.deactivated(label));
    }),

    remove: asyncHandler(async (req: Request, res: Response) => {
      await service.remove(params<IdParams>(req).id, req);
      ApiResponse.ok(res, null, MESSAGES.deleted(label));
    }),
  };
}
