import { Router } from 'express';
import { ecosystemController } from './ecosystem.controller';

/*
 * /api/v1/public/ecosystem — the अमृत प्रणाली cards, for the public website.
 *
 * Unauthenticated for the same reasons as the other public feeds: the site has no session. GET only;
 * hidden cards are filtered out by getPublic(); the payload is projected to what the cards print;
 * the global rate limiter applies.
 */
export const publicEcosystemRouter = Router();

publicEcosystemRouter.get('/', ecosystemController.public);
