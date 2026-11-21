import type { Request, Response } from 'express';
import { query } from '../../middleware/validate-request.middleware';
import { asyncHandler } from '../../shared/http/async-handler';
import { ApiResponse } from '../../utils/api-response';
import { attendanceReportsService } from './attendance-reports.service';
import type { AttendanceReportQuery } from './attendance-reports.validation';

export const attendanceReportsController = {
  status: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await attendanceReportsService.status(), 'Attendance report status retrieved successfully');
  }),
  /* Same source headers as /lms-reads: X-Lms-Fetched-At (when the LMS produced the counts) and X-Lms-Cache. */
  report: asyncHandler(async (req: Request, res: Response) => {
    const r = await attendanceReportsService.report(query<AttendanceReportQuery>(req));
    res.setHeader('X-Lms-Fetched-At', r.fetchedAt.toISOString());
    res.setHeader('X-Lms-Cache', r.cache);
    res.setHeader('Cache-Control', 'private, no-store');
    ApiResponse.ok(res, { ...r.data, fetchedAt: r.fetchedAt.toISOString() }, 'Attendance report retrieved successfully');
  }),
};
