import { Router } from 'express';
import { P } from '../../modules/roles-permissions/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { pageBannerController } from './pagebanners.controller';
import { updatePageBannerSchema } from './pagebanners.validator';

/*
 * /api/v1/cms/page-banners — "Page Banners" (the title and subtitle of the banner at the top of the
 * About, FAQ, Programme, Track and Verify pages). The list is every page; a change sets one page by its key.
 *
 * authenticate() is applied once by the parent CMS router, and each route declares the permission it
 * needs.
 */
export const pageBannersRouter = Router();

pageBannersRouter.get('/', authorizePermission(P.CMS_PAGEBANNERS_VIEW), pageBannerController.list);
pageBannersRouter.put(
  '/:key',
  authorizePermission(P.CMS_PAGEBANNERS_UPDATE),
  validateRequest(updatePageBannerSchema),
  pageBannerController.update,
);
