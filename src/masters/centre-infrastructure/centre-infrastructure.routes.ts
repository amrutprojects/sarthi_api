import { Router } from 'express';
import { P } from '../../modules/roles-permissions';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { centreInfrastructureController } from './centre-infrastructure.controller';
import {
  centreInfrastructureIdSchema, centreInfrastructureStatusSchema, centreInfrastructureSummarySchema,
  createCentreInfrastructureSchema, listCentreInfrastructureSchema, updateCentreInfrastructureSchema,
} from './centre-infrastructure.validator';

/*
 * /api/v1/cms/centre-infrastructure — Capacity & Infrastructure (one record per training centre).
 * See state.routes.ts for the shared conventions. No options feed: nothing picks an infrastructure record.
 */
export const centreInfrastructureRouter = Router();

centreInfrastructureRouter.get(
  '/',
  authorizePermission(P.CMS_CENTRE_INFRASTRUCTURE_VIEW),
  validateRequest(listCentreInfrastructureSchema),
  centreInfrastructureController.list,
);
/* Listing KPIs. Registered before /:id so "summary" is never read as an id. */
centreInfrastructureRouter.get(
  '/summary',
  authorizePermission(P.CMS_CENTRE_INFRASTRUCTURE_VIEW),
  validateRequest(centreInfrastructureSummarySchema),
  centreInfrastructureController.summary,
);
centreInfrastructureRouter.post(
  '/',
  authorizePermission(P.CMS_CENTRE_INFRASTRUCTURE_CREATE),
  validateRequest(createCentreInfrastructureSchema),
  centreInfrastructureController.create,
);
centreInfrastructureRouter.get(
  '/:id',
  authorizePermission(P.CMS_CENTRE_INFRASTRUCTURE_VIEW),
  validateRequest(centreInfrastructureIdSchema),
  centreInfrastructureController.get,
);
centreInfrastructureRouter.put(
  '/:id',
  authorizePermission(P.CMS_CENTRE_INFRASTRUCTURE_UPDATE),
  validateRequest(updateCentreInfrastructureSchema),
  centreInfrastructureController.update,
);
centreInfrastructureRouter.patch(
  '/:id',
  authorizePermission(P.CMS_CENTRE_INFRASTRUCTURE_UPDATE),
  validateRequest(updateCentreInfrastructureSchema),
  centreInfrastructureController.update,
);
centreInfrastructureRouter.patch(
  '/:id/status',
  authorizePermission(P.CMS_CENTRE_INFRASTRUCTURE_UPDATE),
  validateRequest(centreInfrastructureStatusSchema),
  centreInfrastructureController.setStatus,
);
centreInfrastructureRouter.delete(
  '/:id',
  authorizePermission(P.CMS_CENTRE_INFRASTRUCTURE_DELETE),
  validateRequest(centreInfrastructureIdSchema),
  centreInfrastructureController.remove,
);
centreInfrastructureRouter.post(
  '/:id/restore',
  authorizePermission(P.CMS_CENTRE_INFRASTRUCTURE_DELETE),
  validateRequest(centreInfrastructureIdSchema),
  centreInfrastructureController.restore,
);
