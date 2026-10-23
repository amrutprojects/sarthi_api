import { Router } from 'express';
import { schemesController } from './schemes.controller';

/*
 * /api/v1/public/schemes — the अमृत योजना विभाग cards, for the public website.
 *
 * Unauthenticated for the same reasons as the other public feeds: the site has no session. GET only;
 * hidden schemes are filtered out by getPublic(); the payload is projected to what the cards print;
 * the global rate limiter applies.
 */
export const publicSchemesRouter = Router();

publicSchemesRouter.get('/', schemesController.public);
