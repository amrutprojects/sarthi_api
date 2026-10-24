import { Router } from 'express';
import { P } from '../../modules/roles-permissions/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { idempotent } from '../../shared/idempotency/idempotency.middleware';
import { topBarController } from './topbar.controller';
import {
  createTopBarLinkSchema,
  reorderSchema,
  topBarLinkIdSchema,
  topBarLinkStatusSchema,
  updateSettingsSchema,
  updateTopBarLinkSchema,
} from './topbar.validator';

/*
 * /api/v1/cms/top-bar — "Top Bar" (the strip at the very top of the website: government name, links,
 * language switch).
 *
 * authenticate() is applied once by the parent CMS router, and each route declares the permission it
 * needs. Creating a link honours the Idempotency-Key header (ADR-0005), so a retried or
 * double-submitted form replays the first response instead of adding the link twice.
 *
 * The static paths (/settings, /order) are declared before /:id so they are never taken for an id.
 */
export const topBarRouter = Router();

topBarRouter.get('/', authorizePermission(P.CMS_TOPBAR_VIEW), topBarController.list);
topBarRouter.post(
  '/',
  authorizePermission(P.CMS_TOPBAR_CREATE),
  validateRequest(createTopBarLinkSchema),
  idempotent,
  topBarController.create,
);

topBarRouter.get('/settings', authorizePermission(P.CMS_TOPBAR_VIEW), topBarController.getSettings);
topBarRouter.put(
  '/settings',
  authorizePermission(P.CMS_TOPBAR_UPDATE),
  validateRequest(updateSettingsSchema),
  topBarController.updateSettings,
);

topBarRouter.put('/order', authorizePermission(P.CMS_TOPBAR_UPDATE), validateRequest(reorderSchema), topBarController.reorder);

topBarRouter.get('/:id', authorizePermission(P.CMS_TOPBAR_VIEW), validateRequest(topBarLinkIdSchema), topBarController.get);
topBarRouter.patch('/:id', authorizePermission(P.CMS_TOPBAR_UPDATE), validateRequest(updateTopBarLinkSchema), topBarController.update);
topBarRouter.patch(
  '/:id/status',
  authorizePermission(P.CMS_TOPBAR_UPDATE),
  validateRequest(topBarLinkStatusSchema),
  topBarController.setStatus,
);
topBarRouter.delete('/:id', authorizePermission(P.CMS_TOPBAR_DELETE), validateRequest(topBarLinkIdSchema), topBarController.remove);
