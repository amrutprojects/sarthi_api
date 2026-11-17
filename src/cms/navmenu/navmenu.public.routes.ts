import { Router } from 'express';
import { navMenuController } from './navmenu.controller';

/*
 * /api/v1/public/nav-menu — which items of the website's menu bar (and its Login / Register button) are
 * shown. Every item comes back, in menu order; the site hides those with `show: false`.
 *
 * Unauthenticated for the same reasons as the other public feeds: the site has no session. GET only;
 * the payload is just each key and its flag; the global rate limiter applies.
 */
export const publicNavMenuRouter = Router();

publicNavMenuRouter.get('/', navMenuController.public);
