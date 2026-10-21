import { Router } from 'express';
import { P } from '../../modules/roles-permissions/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { homeController } from './home.controller';
import { updateHomeGlanceSchema } from './home.validator';

/*
 * /api/v1/cms/home — the home page's "Programme at a glance" card.
 *
 * No public route: the website already receives these figures with the rest of the programme
 * content on /public/modules, and computes the three derived ones the same way this does. A second
 * public feed for the same four numbers would be a second place for them to disagree.
 *
 * PATCH rather than PUT, because only one of the four figures is writable.
 */
export const homeRouter = Router();

homeRouter.get('/', authorizePermission(P.CMS_HOME_VIEW), homeController.get);
homeRouter.patch('/', authorizePermission(P.CMS_HOME_UPDATE), validateRequest(updateHomeGlanceSchema), homeController.update);
