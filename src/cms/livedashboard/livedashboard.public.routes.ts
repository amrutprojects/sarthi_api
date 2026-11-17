import { Router } from 'express';
import { liveDashboardController } from './livedashboard.controller';

/*
 * /api/v1/public/live-dashboard — the home page's "Programme Progress – Live Dashboard": its texts,
 * KPI cards, district figures, training-mode totals and side figures, and which parts are shown.
 *
 * Unauthenticated for the same reasons as the other public feeds: the site has no session. GET only;
 * hidden cards and figures are filtered out by getPublic(); the global rate limiter applies.
 */
export const publicLiveDashboardRouter = Router();

publicLiveDashboardRouter.get('/', liveDashboardController.public);
