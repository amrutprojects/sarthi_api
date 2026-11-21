/*
 * Public API of the attendance-reports module (M3: attendance by division, district, centre and batch, read from the
 * LMS through the M1 read client). The router is mounted by src/routes.ts and is not exported here.
 */
export { AttendanceReportsService, attendanceReportsService, type AttendanceReport } from './attendance-reports.service';
export { ATTENDANCE_REPORT_PERMISSIONS, MAHARASHTRA_DIVISIONS } from './attendance-reports.constants';
export { buildReport, type ReportRow, type ReportLevel } from './attendance-report.builder';
