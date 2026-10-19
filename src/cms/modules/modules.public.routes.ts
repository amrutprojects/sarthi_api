import { Router } from 'express';
import { modulesController } from './modules.controller';

/*
 * /api/v1/public/modules — the Modules page content for the public website.
 *
 * Deliberately NOT behind authenticate(), for the same reasons as the public contact and footer
 * feeds: the site has no session, and this is what lets its Modules page show centrally managed
 * content instead of a hardcoded copy.
 *
 * What makes that safe:
 * - GET only. There is no public write path to any programme table.
 * - Unpublished pages and inactive modules and domains are filtered out by ModulesService.getPublic().
 * - The payload is projected to the words and numbers the page prints — no ids, timestamps,
 *   publication flag or soft-delete state.
 * - The global rate limiter in app.ts applies, as it does to every route.
 */
export const publicModulesRouter = Router();

publicModulesRouter.get('/', modulesController.public);
