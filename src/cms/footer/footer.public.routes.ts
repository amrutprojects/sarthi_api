import { Router } from 'express';
import { footerController } from './footer.controller';

/*
 * /api/v1/public/footer — the site footer for the public website.
 *
 * Deliberately NOT behind authenticate(), for the same reasons as the public contact feed: the site
 * has no session, and this is what lets its footer show centrally managed content instead of a
 * hardcoded copy. The footer renders on every page, so the site caches the response for five
 * minutes rather than refetching per navigation.
 *
 * What makes that safe:
 * - GET only. There is no public write path to any footer table.
 * - Unpublished footers and inactive columns and links are filtered out by FooterService.getPublic().
 * - The payload is projected to the words the footer prints — no ids, timestamps, publication flag
 *   or soft-delete state.
 * - Link hrefs are constrained to app paths and http(s) URLs by the validator, and checked again by
 *   the website before they reach an href attribute.
 * - The global rate limiter in app.ts applies, as it does to every route.
 */
export const publicFooterRouter = Router();

publicFooterRouter.get('/', footerController.public);
