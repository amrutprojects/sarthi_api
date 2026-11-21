import type { Request, Response } from 'express';
import { HTTP_STATUS } from '../../constants/api-response.constants';
import { body, query } from '../../middleware/validate-request.middleware';
import { asyncHandler } from '../../shared/http/async-handler';
import { ApiResponse } from '../../utils/api-response';
import { liveDataSettingService } from './live-data-setting.service';
import { lmsReadsService, type LmsReadResult } from './lms-reads.service';
import type { LiveDataBody, LmsAttendanceQuery, LmsListQuery, LmsLiveSessionsQuery, LmsSummaryQuery } from './lms-reads.validation';

/*
 * Every data answer carries where it came from: X-Lms-Fetched-At (when the LMS produced it) and X-Lms-Cache
 * (HIT / MISS / REVALIDATED), so a screen can show "as of" and support can tell a cached answer from a live one.
 * G-2: the envelope also carries `source: 'live'` and `fetched_at` (the same instant as the header), so a screen
 * badge needs no header access. One answer is always one source: these routes never fall back to local data.
 */
function send<T>(res: Response, r: LmsReadResult<T>, message: string) {
  const fetchedAt = r.fetchedAt.toISOString();
  res.setHeader('X-Lms-Fetched-At', fetchedAt);
  res.setHeader('X-Lms-Cache', r.cache);
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(HTTP_STATUS.OK).json({
    success: true,
    status: HTTP_STATUS.OK,
    message,
    data: r.data,
    ...(r.meta ? { meta: r.meta } : {}),
    source: 'live',
    fetched_at: fetchedAt,
  });
}

export const lmsReadsController = {
  status: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, lmsReadsService.status(), 'LMS reads status retrieved successfully');
  }),
  /* G-2 "Show live LMS data": the switch state, for the screens' badge and the System Settings screen. */
  liveData: asyncHandler(async (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store');
    ApiResponse.ok(res, await liveDataSettingService.state(), 'Live LMS data setting retrieved successfully');
  }),
  setLiveData: asyncHandler(async (req: Request, res: Response) => {
    const state = await liveDataSettingService.set(req, body<LiveDataBody>(req).enabled);
    /* Switching on starts from fresh LMS answers, never ones cached before the switch was last off. */
    if (state.setting) lmsReadsService.clearCache();
    ApiResponse.ok(res, state, 'Live LMS data setting updated successfully');
  }),
  summary: asyncHandler(async (req: Request, res: Response) => {
    send(res, await lmsReadsService.summary(query<LmsSummaryQuery>(req)), 'LMS summary retrieved successfully');
  }),
  centres: asyncHandler(async (req: Request, res: Response) => {
    send(res, await lmsReadsService.centres(query<LmsListQuery>(req)), 'LMS centres retrieved successfully');
  }),
  batches: asyncHandler(async (req: Request, res: Response) => {
    send(res, await lmsReadsService.batches(query<LmsListQuery>(req)), 'LMS batches retrieved successfully');
  }),
  sessions: asyncHandler(async (req: Request, res: Response) => {
    send(res, await lmsReadsService.sessions(query<LmsListQuery>(req)), 'LMS class sessions retrieved successfully');
  }),
  liveSessions: asyncHandler(async (req: Request, res: Response) => {
    send(res, await lmsReadsService.liveSessions(query<LmsLiveSessionsQuery>(req)), 'LMS live sessions retrieved successfully');
  }),
  trainers: asyncHandler(async (req: Request, res: Response) => {
    send(res, await lmsReadsService.trainers(query<LmsListQuery>(req)), 'LMS trainers retrieved successfully');
  }),
  attendance: asyncHandler(async (req: Request, res: Response) => {
    send(res, await lmsReadsService.attendance(query<LmsAttendanceQuery>(req)), 'LMS attendance retrieved successfully');
  }),
};
