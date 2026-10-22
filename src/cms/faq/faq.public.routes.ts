import { Router } from 'express';
import { faqController } from './faq.controller';

/*
 * /api/v1/public/faqs — the FAQ page content for the public website.
 *
 * Deliberately NOT behind authenticate(), for the same reasons as the public contact, footer and
 * modules feeds: the site has no session, and this is what lets its FAQ page show centrally managed
 * questions instead of a hardcoded copy.
 *
 * What makes that safe:
 * - GET only. There is no public write path to the faqs table.
 * - Inactive and deleted questions are filtered out by FaqService.getPublic().
 * - The payload is projected to the words the page prints — no ids, timestamps or status.
 * - The global rate limiter in app.ts applies, as it does to every route.
 */
export const publicFaqRouter = Router();

publicFaqRouter.get('/', faqController.public);
