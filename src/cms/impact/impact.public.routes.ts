import { Router } from 'express';
import { impactController } from './impact.controller';

/*
 * /api/v1/public/impact — the अमृतचा प्रभाव statistic cards, for the public website.
 *
 * Unauthenticated for the same reasons as the other public feeds: the site has no session. GET only;
 * hidden cards are filtered out by getPublic(); the payload is projected to what the cards print;
 * the global rate limiter applies.
 */
export const publicImpactRouter = Router();

publicImpactRouter.get('/', impactController.public);
