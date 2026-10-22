import { Router } from 'express';
import { applyController } from './apply.controller';

/*
 * /api/v1/public/apply — the Apply page ("How to Apply") content for the public website.
 *
 * Deliberately NOT behind authenticate(), for the same reasons as the public contact, footer,
 * modules, FAQ and eligibility feeds: the site has no session, and this is what lets its Apply page
 * show centrally managed steps, facts and portal link instead of a hardcoded copy.
 *
 * What makes that safe:
 * - GET only. There is no public write path to either apply table.
 * - Inactive and deleted steps, facts and documents are filtered out by ApplyService.getPublic().
 * - The payload is projected to the words the page prints — no ids, timestamps, kind or status.
 * - The portal link is https-only, enforced by the validator and by a CHECK constraint.
 * - The global rate limiter in app.ts applies, as it does to every route.
 */
export const publicApplyRouter = Router();

publicApplyRouter.get('/', applyController.public);
