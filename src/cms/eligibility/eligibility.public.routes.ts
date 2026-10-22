import { Router } from 'express';
import { eligibilityController } from './eligibility.controller';

/*
 * /api/v1/public/eligibility — the Eligibility page content for the public website.
 *
 * Deliberately NOT behind authenticate(), for the same reasons as the public contact, footer,
 * modules and FAQ feeds: the site has no session, and this is what lets its Eligibility page show
 * centrally managed criteria and documents instead of a hardcoded copy.
 *
 * What makes that safe:
 * - GET only. There is no public write path to either eligibility table.
 * - Inactive and deleted criteria and documents are filtered out by EligibilityService.getPublic().
 * - The payload is projected to the words the page prints — no ids, timestamps, kind or status.
 * - The global rate limiter in app.ts applies, as it does to every route.
 */
export const publicEligibilityRouter = Router();

publicEligibilityRouter.get('/', eligibilityController.public);
