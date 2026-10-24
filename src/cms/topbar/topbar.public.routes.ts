import { Router } from 'express';
import { topBarController } from './topbar.controller';

/*
 * /api/v1/public/top-bar — the strip at the very top of the public website: the government name, its
 * links and whether the language switch is shown.
 *
 * Unauthenticated for the same reasons as the other public feeds: the site has no session. GET only;
 * hidden links are filtered out by getPublic(); the payload is projected to what the strip prints;
 * the global rate limiter applies.
 */
export const publicTopBarRouter = Router();

publicTopBarRouter.get('/', topBarController.public);
