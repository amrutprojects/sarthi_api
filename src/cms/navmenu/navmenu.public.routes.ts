import { Router } from 'express';
import { navMenuController } from './navmenu.controller';

/*
 * /api/v1/public/nav-menu — which items of the website's menu bar (and its Login / Register button) are
 * shown, and their custom names. Every item comes back, in menu order; the site hides those with
 * `show: false` and uses its default name where `label` is null.
 *
 * Unauthenticated for the same reasons as the other public feeds: the site has no session. GET only;
 * the payload is just each key, its flag and its name; the global rate limiter applies.
 */
export const publicNavMenuRouter = Router();

publicNavMenuRouter.get('/', navMenuController.public);
