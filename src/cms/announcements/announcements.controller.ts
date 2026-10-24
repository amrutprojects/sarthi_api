import type { Request, Response } from 'express';
import { body, params } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { announcementsService } from './announcements.service';
import type { CreateAnnouncementBody, ReorderBody, UpdateAnnouncementBody, UpdateSettingsBody } from './announcements.validator';

type IdParams = { id: string };

export const announcementsController = {
  list: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await announcementsService.listForAdmin(), 'Announcements retrieved successfully');
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await announcementsService.getForAdmin(params<IdParams>(req).id), 'Announcement retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(
      res,
      await announcementsService.create(body<CreateAnnouncementBody>(req), req),
      'Announcement created successfully',
    );
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await announcementsService.update(params<IdParams>(req).id, body<UpdateAnnouncementBody>(req), req);
    ApiResponse.ok(res, data, 'Announcement updated successfully');
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    const data = await announcementsService.setActive(params<IdParams>(req).id, isActive, req);
    ApiResponse.ok(res, data, isActive ? 'Announcement shown on the website' : 'Announcement hidden from the website');
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await announcementsService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Announcement deleted successfully');
  }),

  reorder: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await announcementsService.reorder(body<ReorderBody>(req).ids, req), 'Display order updated successfully');
  }),

  getSettings: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await announcementsService.getSettings(), 'Ticker settings retrieved successfully');
  }),

  updateSettings: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      await announcementsService.updateSettings(body<UpdateSettingsBody>(req), req),
      'Ticker settings updated successfully',
    );
  }),

  /*
   * Public read. `null` is a legitimate answer — the ticker has not been configured — so it is a 200
   * with no data rather than a 404.
   */
  public: asyncHandler(async (_req: Request, res: Response) => {
    const data = await announcementsService.getPublic();
    ApiResponse.ok(res, data, data ? 'Announcements retrieved successfully' : 'The announcement ticker is not configured');
  }),
};
