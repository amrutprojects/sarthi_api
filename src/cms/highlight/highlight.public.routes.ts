import { Router } from 'express';
import { highlightController } from './highlight.controller';

/*
 * /api/v1/public/highlight — the home page's programme section, for the public website.
 *
 * Unauthenticated for the same reasons as the other public feeds: the site has no session, and
 * this is what lets the band show centrally managed content instead of a hardcoded copy.
 *
 * GET only; unpublished sections and inactive objectives are filtered out by getPublic(); the
 * payload is projected to the words the page prints; the global rate limiter applies.
 */
export const publicHighlightRouter = Router();

publicHighlightRouter.get('/', highlightController.public);
