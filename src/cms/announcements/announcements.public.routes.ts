import { Router } from 'express';
import { announcementsController } from './announcements.controller';

/*
 * /api/v1/public/announcements — the scrolling ticker at the top of the public website.
 *
 * Unauthenticated for the same reasons as the other public feeds: the site has no session. GET only;
 * hidden announcements are filtered out by getPublic(); the payload is projected to what the ticker
 * prints; the global rate limiter applies.
 */
export const publicAnnouncementsRouter = Router();

publicAnnouncementsRouter.get('/', announcementsController.public);
