import { Router } from 'express';
import { quickActionsController } from './quickactions.controller';

/*
 * /api/v1/public/quick-actions — the strip of tiles under the home page hero: each tile's title,
 * subtitle, icon and link, and whether the strip is shown.
 *
 * Unauthenticated for the same reasons as the other public feeds: the site has no session. GET only;
 * hidden tiles are filtered out by getPublic(); the payload is projected to what the strip prints;
 * the global rate limiter applies.
 */
export const publicQuickActionsRouter = Router();

publicQuickActionsRouter.get('/', quickActionsController.public);
