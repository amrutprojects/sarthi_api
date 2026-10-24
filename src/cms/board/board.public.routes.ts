import { Router } from 'express';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { boardController } from './board.controller';
import { photoFileSchema } from './board.validator';

/*
 * /api/v1/public/board-members — the Leadership & Governing Board section, for the public website.
 *
 * Unauthenticated for the same reasons as the other public feeds: the site has no session. GET only;
 * hidden members are filtered out by getPublic(); the payload is projected to what the cards print;
 * the global rate limiter applies.
 *
 * /photos/:file serves a visible member's photo and nothing else: the name must be a stored photo's
 * '<uuid>.<ext>' and belong to a visible, non-deleted member. There is no upload here — writes go
 * through the authenticated /cms/board-members routes only.
 */
export const publicBoardRouter = Router();

publicBoardRouter.get('/', boardController.public);
publicBoardRouter.get('/photos/:file', validateRequest(photoFileSchema), boardController.publicPhoto);
