import { Router } from 'express';
import { P } from '../../modules/roles-permissions/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { navMenuController } from './navmenu.controller';
import { updateNavMenuItemSchema } from './navmenu.validator';

/*
 * /api/v1/cms/nav-menu — "Navigation Menu" (the show/hide switch of each item of the website's menu bar
 * and its Login / Register button). The list is every item; a change sets one item by its key.
 *
 * authenticate() is applied once by the parent CMS router, and each route declares the permission it
 * needs.
 */
export const navMenuRouter = Router();

navMenuRouter.get('/', authorizePermission(P.CMS_NAVMENU_VIEW), navMenuController.list);
navMenuRouter.put('/:key', authorizePermission(P.CMS_NAVMENU_UPDATE), validateRequest(updateNavMenuItemSchema), navMenuController.update);
