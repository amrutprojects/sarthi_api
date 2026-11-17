import { Router } from 'express';
import { P } from '../../modules/roles-permissions/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { idempotent } from '../../shared/idempotency/idempotency.middleware';
import { quickActionsController } from './quickactions.controller';
import {
  createQuickActionSchema,
  quickActionIdSchema,
  quickActionStatusSchema,
  reorderSchema,
  updateQuickActionSchema,
} from './quickactions.validator';

/*
 * /api/v1/cms/quick-actions — "Quick Actions" (the strip of tiles under the home page hero: Apply Now,
 * Check Application Status, Verify Certificate, Training centres).
 *
 * authenticate() is applied once by the parent CMS router, and each route declares the permission it
 * needs. Creating a tile honours the Idempotency-Key header (ADR-0005), so a retried or
 * double-submitted form replays the first response instead of adding the tile twice.
 *
 * There are no settings routes: the strip's one setting (shown or hidden) is the "Show on website"
 * switch, /cms/section-visibility/quick-actions. The static path (/order) is declared before /:id so
 * it is never taken for an id.
 */
export const quickActionsRouter = Router();

quickActionsRouter.get('/', authorizePermission(P.CMS_QUICKACTIONS_VIEW), quickActionsController.list);
quickActionsRouter.post(
  '/',
  authorizePermission(P.CMS_QUICKACTIONS_CREATE),
  validateRequest(createQuickActionSchema),
  idempotent,
  quickActionsController.create,
);

quickActionsRouter.put(
  '/order',
  authorizePermission(P.CMS_QUICKACTIONS_UPDATE),
  validateRequest(reorderSchema),
  quickActionsController.reorder,
);

quickActionsRouter.get(
  '/:id',
  authorizePermission(P.CMS_QUICKACTIONS_VIEW),
  validateRequest(quickActionIdSchema),
  quickActionsController.get,
);
quickActionsRouter.patch(
  '/:id',
  authorizePermission(P.CMS_QUICKACTIONS_UPDATE),
  validateRequest(updateQuickActionSchema),
  quickActionsController.update,
);
quickActionsRouter.patch(
  '/:id/status',
  authorizePermission(P.CMS_QUICKACTIONS_UPDATE),
  validateRequest(quickActionStatusSchema),
  quickActionsController.setStatus,
);
quickActionsRouter.delete(
  '/:id',
  authorizePermission(P.CMS_QUICKACTIONS_DELETE),
  validateRequest(quickActionIdSchema),
  quickActionsController.remove,
);
