import type { Request, Response } from 'express';
import { body, params, query } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../shared/http/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { lmsCalendarService } from './calendar.service';
import type {
  CreateLmsCalendarBody, LearningConfigQuery, ListLmsCalendarsQuery, LmsCalendarOptionsQuery, UpdateLearningConfigBody,
  UpdateLmsCalendarBody,
} from './calendar.validator';
import { lmsLearningConfigService } from './learning-config.service';

type IdParams = { id: string };

export const lmsCalendarController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await lmsCalendarService.list(query<ListLmsCalendarsQuery>(req));
    ApiResponse.ok(res, page.items, 'Calendars retrieved successfully', page.meta);
  }),

  options: asyncHandler(async (req: Request, res: Response) => {
    const q = query<LmsCalendarOptionsQuery>(req);
    ApiResponse.ok(res, await lmsCalendarService.options(q.entityId, q.centreId), 'Calendars retrieved successfully');
  }),

  formOptions: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, lmsCalendarService.formOptions(), 'Calendar form options retrieved successfully');
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsCalendarService.get(params<IdParams>(req).id), 'Calendar retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await lmsCalendarService.create(body<CreateLmsCalendarBody>(req), req), 'Calendar created successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      await lmsCalendarService.update(params<IdParams>(req).id, body<UpdateLmsCalendarBody>(req), req),
      'Calendar updated successfully',
    );
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    ApiResponse.ok(res, await lmsCalendarService.setStatus(params<IdParams>(req).id, isActive, req), isActive ? 'Calendar activated' : 'Calendar deactivated');
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await lmsCalendarService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Calendar deleted successfully');
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsCalendarService.restore(params<IdParams>(req).id, req), 'Calendar restored (inactive)');
  }),

  learningConfig: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsLearningConfigService.get(query<LearningConfigQuery>(req).entityId), 'Learning configuration retrieved successfully');
  }),

  updateLearningConfig: asyncHandler(async (req: Request, res: Response) => {
    const { key } = params<{ key: string }>(req);
    ApiResponse.ok(
      res,
      await lmsLearningConfigService.update(key, body<UpdateLearningConfigBody>(req), req),
      'Learning configuration updated successfully',
    );
  }),
};
