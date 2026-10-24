import { Router } from 'express';
import { aboutController } from './about.controller';

/*
 * /api/v1/public/about — the About AMRUT section, for the public website.
 *
 * Unauthenticated for the same reasons as the other public feeds: the site has no session. GET only;
 * hidden rows and cards are filtered out by getPublic(); the payload is projected to what the
 * section prints; the global rate limiter applies.
 */
export const publicAboutRouter = Router();

publicAboutRouter.get('/', aboutController.public);
