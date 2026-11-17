import type { Request, Response } from 'express';
import { body, params } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { liveDashboardService } from './livedashboard.service';
import type {
  CreateCardBody,
  CreateStatBody,
  DistrictCodeParams,
  ReorderBody,
  UpdateCardBody,
  UpdateDistrictBody,
  UpdateSettingsBody,
  UpdateStatBody,
} from './livedashboard.validator';

type IdParams = { id: string };

/* What the handlers need of an ordered list in the service (liveDashboardService.cards / .stats). */
interface OrderedListApi<C, U> {
  list(): Promise<unknown>;
  get(id: string): Promise<unknown>;
  create(input: C, req?: Request): Promise<unknown>;
  update(id: string, input: U, req?: Request): Promise<unknown>;
  setActive(id: string, isActive: boolean, req?: Request): Promise<unknown>;
  remove(id: string, req?: Request): Promise<void>;
  reorder(ids: string[], req?: Request): Promise<unknown>;
}

/* The handlers of one ordered list (the KPI cards or the side figures); only the wording differs. */
function listHandlers<C, U>(list: OrderedListApi<C, U>, noun: string, plural: string) {
  return {
    list: asyncHandler(async (_req: Request, res: Response) => {
      ApiResponse.ok(res, await list.list(), `${plural} retrieved successfully`);
    }),
    get: asyncHandler(async (req: Request, res: Response) => {
      ApiResponse.ok(res, await list.get(params<IdParams>(req).id), `${noun} retrieved successfully`);
    }),
    create: asyncHandler(async (req: Request, res: Response) => {
      ApiResponse.created(res, await list.create(body<C>(req), req), `${noun} created successfully`);
    }),
    update: asyncHandler(async (req: Request, res: Response) => {
      ApiResponse.ok(res, await list.update(params<IdParams>(req).id, body<U>(req), req), `${noun} updated successfully`);
    }),
    setStatus: asyncHandler(async (req: Request, res: Response) => {
      const { isActive } = body<{ isActive: boolean }>(req);
      const data = await list.setActive(params<IdParams>(req).id, isActive, req);
      ApiResponse.ok(res, data, isActive ? `${noun} shown on the website` : `${noun} hidden from the website`);
    }),
    remove: asyncHandler(async (req: Request, res: Response) => {
      await list.remove(params<IdParams>(req).id, req);
      ApiResponse.ok(res, null, `${noun} deleted successfully`);
    }),
    reorder: asyncHandler(async (req: Request, res: Response) => {
      ApiResponse.ok(res, await list.reorder(body<ReorderBody>(req).ids, req), 'Display order updated successfully');
    }),
  };
}

export const liveDashboardController = {
  getSettings: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await liveDashboardService.getSettings(), 'Dashboard settings retrieved successfully');
  }),

  updateSettings: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await liveDashboardService.updateSettings(body<UpdateSettingsBody>(req), req), 'Dashboard settings updated successfully');
  }),

  cards: listHandlers<CreateCardBody, UpdateCardBody>(liveDashboardService.cards, 'Dashboard card', 'Dashboard cards'),
  stats: listHandlers<CreateStatBody, UpdateStatBody>(liveDashboardService.stats, 'Dashboard figure', 'Dashboard figures'),

  listDistricts: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await liveDashboardService.listDistricts(), 'Districts retrieved successfully');
  }),

  updateDistrict: asyncHandler(async (req: Request, res: Response) => {
    const data = await liveDashboardService.updateDistrict(params<DistrictCodeParams>(req).code, body<UpdateDistrictBody>(req), req);
    ApiResponse.ok(res, data, 'District updated successfully');
  }),

  /*
   * Public read. `null` is a legitimate answer — the dashboard has not been configured — so it is a
   * 200 with no data rather than a 404.
   */
  public: asyncHandler(async (_req: Request, res: Response) => {
    const data = await liveDashboardService.getPublic();
    ApiResponse.ok(res, data, data ? 'Live dashboard retrieved successfully' : 'The live dashboard is not configured');
  }),
};
