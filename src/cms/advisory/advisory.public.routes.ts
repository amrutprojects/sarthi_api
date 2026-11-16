import { Router } from 'express';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { advisoryController } from './advisory.controller';
import { photoFileSchema } from './advisory.validator';

/*
 * /api/v1/public/advisory-committee — the AMRUT Kalash Advisory Committee page, for the public website.
 *
 * Unauthenticated for the same reasons as the other public feeds: the site has no session. GET only;
 * hidden members are filtered out by getPublic(); the payload is projected to what the cards print;
 * the global rate limiter applies.
 *
 * /photos/:file serves a visible member's photo and nothing else: the name must be a stored photo's
 * '<uuid>.<ext>' and belong to a visible, non-deleted member. There is no upload here — writes go
 * through the authenticated /cms/advisory-committee routes only.
 */
export const publicAdvisoryRouter = Router();

publicAdvisoryRouter.get('/', advisoryController.public);
publicAdvisoryRouter.get('/photos/:file', validateRequest(photoFileSchema), advisoryController.publicPhoto);
