import { Router } from 'express';
import { brandBarController } from './brandbar.controller';

/*
 * /api/v1/public/brand-bar — the bar under the Top Bar on the public website: the programme's title,
 * the organisation's full name and the implementation partner.
 *
 * Unauthenticated for the same reasons as the other public feeds: the site has no session. GET only;
 * the payload is projected to what the bar prints; the global rate limiter applies.
 */
export const publicBrandBarRouter = Router();

publicBrandBarRouter.get('/', brandBarController.public);
