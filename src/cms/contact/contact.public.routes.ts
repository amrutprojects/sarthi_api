import { Router } from 'express';
import { contactController } from './contact.controller';

/*
 * /api/v1/public/contact — the Contact page content for the public website.
 *
 * Deliberately NOT behind authenticate(), for the same reasons as the public geography feed: the
 * site has no session, and this is what lets its Contact page show centrally managed content instead
 * of a hardcoded copy.
 *
 * What makes that safe:
 * - GET only. There is no public write path to any contact table.
 * - Unpublished pages and inactive cards are filtered out by ContactService.getPublic().
 * - The payload is projected to the words the page prints — no ids, timestamps, publication flag or
 *   soft-delete state (ContactService.toPublicOrganization).
 * - The global rate limiter in app.ts applies, as it does to every route.
 */
export const publicContactRouter = Router();

publicContactRouter.get('/', contactController.public);
