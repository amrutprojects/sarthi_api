import { Router } from 'express';
import { P } from '../../modules/roles-permissions/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { brandBarController } from './brandbar.controller';
import { updateBrandBarSchema } from './brandbar.validator';

/*
 * /api/v1/cms/brand-bar — "Brand Bar" (the bar under the Top Bar: the programme's title, the
 * organisation's full name and the implementation partner). A singleton, viewed and replaced.
 *
 * authenticate() is applied once by the parent CMS router, and each route declares the permission it
 * needs.
 */
export const brandBarRouter = Router();

brandBarRouter.get('/', authorizePermission(P.CMS_BRANDBAR_VIEW), brandBarController.get);
brandBarRouter.put('/', authorizePermission(P.CMS_BRANDBAR_UPDATE), validateRequest(updateBrandBarSchema), brandBarController.update);
