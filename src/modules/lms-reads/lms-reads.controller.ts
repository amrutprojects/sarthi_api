import type { Request, Response } from 'express';
import { query } from '../../middleware/validate-request.middleware';
import { asyncHandler } from '../../shared/http/async-handler';
import { ApiResponse } from '../../utils/api-response';
import { lmsReadsService, type LmsReadResult } from './lms-reads.service';
import type { LmsAttendanceQuery, LmsListQuery, LmsLiveSessionsQuery, LmsSummaryQuery } from './lms-reads.validation';

/*
 * Every data answer carries where it came from: X-Lms-Fetched-At (when the LMS produced it) and X-Lms-Cache
 * (HIT / MISS / REVALIDATED), so a screen can show "as of" and support can tell a cached answer from a live one.
 */
function send<T>(res: Response, r: LmsReadResult<T>, message: string) {
  res.setHeader('X-Lms-Fetched-At', r.fetchedAt.toISOString());
  res.setHeader('X-Lms-Cache', r.cache);
  res.setHeader('Cache-Control', 'private, no-store');
  ApiResponse.ok(res, r.data, message, r.meta);
}

export const lmsReadsController = {
  status: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, lmsReadsService.status(), 'LMS reads status retrieved successfully');
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
