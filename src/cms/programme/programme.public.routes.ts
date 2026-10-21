import { Router } from 'express';
import { programmeController } from './programme.controller';

/*
 * /api/v1/public/programme — the Programme page content for the public website. Not behind authenticate(), like the
 * other public CMS feeds: GET only, unpublished content is filtered out by ProgrammeService.getPublic(), and the
 * payload carries only the words and numbers the page prints. The global rate limiter applies.
 */
export const publicProgrammeRouter = Router();

publicProgrammeRouter.get('/', programmeController.public);
