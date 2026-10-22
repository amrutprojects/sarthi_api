import { Router } from 'express';
import { heroController } from './hero.controller';

/*
 * /api/v1/public/hero — the home page's hero banner, for the public website.
 *
 * Unauthenticated for the same reasons as the other public feeds: the site has no session, and
 * this is what lets the banner show centrally managed content instead of a hardcoded copy.
 *
 * GET only; an unpublished section and hidden slides are filtered out by getPublic(); the payload
 * is projected to the words and links the banner prints; the global rate limiter applies.
 */
export const publicHeroRouter = Router();

publicHeroRouter.get('/', heroController.public);
