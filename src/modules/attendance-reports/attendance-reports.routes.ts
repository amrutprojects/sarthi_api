import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.middleware';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { ATTENDANCE_REPORT_PERMISSIONS } from './attendance-reports.constants';
import { attendanceReportsController as c } from './attendance-reports.controller';
import { attendanceReportQuery } from './attendance-reports.validation';

/*
 * /api/v1/attendance-reports — M3 attendance by division, district, centre and batch (docs/m3-attendance-reports.md).
 * GET only; a session and one of ATTENDANCE_REPORT_PERMISSIONS. Panel users carry no district or division assignment
 * today, so every permitted user sees the whole of Amrut (the doc says how area scoping would plug in).
 */
export const attendanceReportsRouter = Router();

attendanceReportsRouter.use(authenticate);

const allowed = authorizePermission([...ATTENDANCE_REPORT_PERMISSIONS], { any: true });

attendanceReportsRouter.get('/status', allowed, c.status);
attendanceReportsRouter.get('/', allowed, validateRequest({ query: attendanceReportQuery }), c.report);
