import { Router } from 'express';
import { P } from '../../modules/roles-permissions/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { heroController } from './hero.controller';
import { heroStatusSchema, updateHeroSchema } from './hero.validator';

/*
 * /api/v1/cms/hero — the home page's hero banner.
 *
 * authenticate() is applied once by the parent CMS router, and each route declares the permission
 * it needs. No POST and no DELETE: the section is a database-enforced singleton created by the
 * seed. PUT replaces it whole, slides included, which is what the admin screen submits; PATCH
 * /status changes only visibility.
 *
 * The same screen manages the "Programme at a glance" card beside the slides: GET reports its
 * figures and PUT writes its one stored figure, the district count. This replaced /cms/home.
 */
export const heroRouter = Router();

heroRouter.get('/', authorizePermission(P.CMS_HERO_VIEW), heroController.get);
heroRouter.put('/', authorizePermission(P.CMS_HERO_UPDATE), validateRequest(updateHeroSchema), heroController.update);
heroRouter.patch('/status', authorizePermission(P.CMS_HERO_UPDATE), validateRequest(heroStatusSchema), heroController.setPublished);
