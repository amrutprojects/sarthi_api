import { Router, type NextFunction, type Request, type Response } from 'express';
import { env } from '../../config/env.config';
import { HTTP_STATUS } from '../../constants/api-response.constants';
import { authenticate } from '../../middleware/authenticate.middleware';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { AppError } from '../../shared/errors/app-error';
import { LIVE_DATA_OFF, liveDataSettingService } from './live-data-setting.service';
import { LIVE_DATA_SETTING_PERMISSIONS as S, LMS_READ_ANY, LMS_READ_PERMISSIONS as P } from './lms-reads.constants';
import { lmsReadsController as c } from './lms-reads.controller';
import { liveDataBody, lmsAttendanceQuery, lmsListQuery, lmsLiveSessionsQuery, lmsSummaryQuery } from './lms-reads.validation';

/*
 * /api/v1/lms-reads — the Panel's LMS data, read live from the LMS tenant API (/tenant/v1) with Amrut's tenant key
 * (M1). Every route needs a session and the `.view` right of the screen it feeds (lms-reads.constants.ts).
 * While LMS_READS_ENABLED is off the data routes answer 404 LMS_READS_DISABLED; /status always answers, so a screen
 * can decide between these reads and its current source.
 *
 * G-2: the data routes also need the Panel setting "Show live LMS data" (GET / PUT /live-data). The master switch is
 * checked first, so while LMS_READS_ENABLED is off the answers stay exactly the M1 ones; with the master switch on and
 * the setting off they answer 404 LMS_LIVE_DATA_OFF and nothing reaches the LMS.
 */
export const lmsReadsRouter = Router();

lmsReadsRouter.use(authenticate);

const any = (codes: readonly string[]) => authorizePermission([...codes], { any: true });

/* G-2 gate of the data routes (after the permission check, before validation and any LMS call). */
async function liveDataGate(_req: Request, _res: Response, next: NextFunction) {
  try {
    /* Master switch off: the service answers 404 LMS_READS_DISABLED, as before G-2. */
    if (!env.LMS_READS_ENABLED) return next();
    if (!(await liveDataSettingService.isOn()))
      return next(new AppError(HTTP_STATUS.NOT_FOUND, 'Live LMS data is switched off (System Settings)', LIVE_DATA_OFF));
    return next();
  } catch (err) {
    return next(err);
  }
}

lmsReadsRouter.get('/status', any(LMS_READ_ANY), c.status);
lmsReadsRouter.get('/live-data', any(S.view), c.liveData);
lmsReadsRouter.put('/live-data', any(S.update), validateRequest({ body: liveDataBody }), c.setLiveData);
lmsReadsRouter.get('/summary', any(P.summary), liveDataGate, validateRequest({ query: lmsSummaryQuery }), c.summary);
lmsReadsRouter.get('/centres', any(P.centres), liveDataGate, validateRequest({ query: lmsListQuery }), c.centres);
lmsReadsRouter.get('/batches', any(P.batches), liveDataGate, validateRequest({ query: lmsListQuery }), c.batches);
lmsReadsRouter.get('/sessions', any(P.sessions), liveDataGate, validateRequest({ query: lmsListQuery }), c.sessions);
lmsReadsRouter.get('/live-sessions', any(P.sessions), liveDataGate, validateRequest({ query: lmsLiveSessionsQuery }), c.liveSessions);
lmsReadsRouter.get('/trainers', any(P.trainers), liveDataGate, validateRequest({ query: lmsListQuery }), c.trainers);
lmsReadsRouter.get('/attendance', any(P.attendance), liveDataGate, validateRequest({ query: lmsAttendanceQuery }), c.attendance);
