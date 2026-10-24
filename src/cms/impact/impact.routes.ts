import { Router } from 'express';
import { P } from '../../modules/roles-permissions/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { idempotent } from '../../shared/idempotency/idempotency.middleware';
import { impactController } from './impact.controller';
import {
  createImpactStatSchema,
  impactStatIdSchema,
  impactStatStatusSchema,
  reorderSchema,
  updateImpactStatSchema,
  updateSectionSchema,
} from './impact.validator';

/*
 * /api/v1/cms/impact — "AMRUT Impact Management" (the अमृतचा प्रभाव statistic cards).
 *
 * authenticate() is applied once by the parent CMS router, and each route declares the permission it
 * needs. Creating a card honours the Idempotency-Key header (ADR-0005), so a retried or
 * double-submitted form replays the first response instead of adding the card twice.
 *
 * The static paths (/settings, /order) are declared before /:id so they are never taken for an id.
 */
export const impactRouter = Router();

impactRouter.get('/', authorizePermission(P.CMS_IMPACT_VIEW), impactController.list);
impactRouter.post(
  '/',
  authorizePermission(P.CMS_IMPACT_CREATE),
  validateRequest(createImpactStatSchema),
  idempotent,
  impactController.create,
);

impactRouter.get('/settings', authorizePermission(P.CMS_IMPACT_VIEW), impactController.getSection);
impactRouter.put(
  '/settings',
  authorizePermission(P.CMS_IMPACT_UPDATE),
  validateRequest(updateSectionSchema),
  impactController.updateSection,
);

impactRouter.put('/order', authorizePermission(P.CMS_IMPACT_UPDATE), validateRequest(reorderSchema), impactController.reorder);

impactRouter.get('/:id', authorizePermission(P.CMS_IMPACT_VIEW), validateRequest(impactStatIdSchema), impactController.get);
impactRouter.patch('/:id', authorizePermission(P.CMS_IMPACT_UPDATE), validateRequest(updateImpactStatSchema), impactController.update);
impactRouter.patch(
  '/:id/status',
  authorizePermission(P.CMS_IMPACT_UPDATE),
  validateRequest(impactStatStatusSchema),
  impactController.setStatus,
);
impactRouter.delete('/:id', authorizePermission(P.CMS_IMPACT_DELETE), validateRequest(impactStatIdSchema), impactController.remove);
