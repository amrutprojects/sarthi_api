import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.middleware';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { LMS_READ_ANY, LMS_READ_PERMISSIONS as P } from './lms-reads.constants';
import { lmsReadsController as c } from './lms-reads.controller';
import { lmsAttendanceQuery, lmsListQuery, lmsLiveSessionsQuery, lmsSummaryQuery } from './lms-reads.validation';

/*
 * /api/v1/lms-reads — the Panel's LMS data, read live from the LMS tenant API (/tenant/v1) with Amrut's tenant key
 * (M1). GET only. Every route needs a session and the `.view` right of the screen it feeds (lms-reads.constants.ts).
 * While LMS_READS_ENABLED is off the data routes answer 404 LMS_READS_DISABLED; /status always answers, so a screen
 * can decide between these reads and its current source.
 */
export const lmsReadsRouter = Router();

lmsReadsRouter.use(authenticate);

const any = (codes: readonly string[]) => authorizePermission([...codes], { any: true });

lmsReadsRouter.get('/status', any(LMS_READ_ANY), c.status);
lmsReadsRouter.get('/summary', any(P.summary), validateRequest({ query: lmsSummaryQuery }), c.summary);
lmsReadsRouter.get('/centres', any(P.centres), validateRequest({ query: lmsListQuery }), c.centres);
lmsReadsRouter.get('/batches', any(P.batches), validateRequest({ query: lmsListQuery }), c.batches);
lmsReadsRouter.get('/sessions', any(P.sessions), validateRequest({ query: lmsListQuery }), c.sessions);
lmsReadsRouter.get('/live-sessions', any(P.sessions), validateRequest({ query: lmsLiveSessionsQuery }), c.liveSessions);
lmsReadsRouter.get('/trainers', any(P.trainers), validateRequest({ query: lmsListQuery }), c.trainers);
lmsReadsRouter.get('/attendance', any(P.attendance), validateRequest({ query: lmsAttendanceQuery }), c.attendance);
