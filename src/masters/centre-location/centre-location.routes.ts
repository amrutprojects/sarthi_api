import { Router } from 'express';
import { P } from '../../modules/roles-permissions';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { centreLocationController } from './centre-location.controller';
import {
  centreLocationIdSchema, centreLocationStatusSchema, createCentreLocationSchema, listCentreLocationsSchema, updateCentreLocationSchema,
} from './centre-location.validator';

/*
 * /api/v1/cms/centre-locations — Location Information (one record per training centre).
 * See state.routes.ts for the shared conventions. No options feed: nothing picks a location record.
 */
export const centreLocationRouter = Router();

centreLocationRouter.get(
  '/',
  authorizePermission(P.CMS_CENTRE_LOCATIONS_VIEW),
  validateRequest(listCentreLocationsSchema),
  centreLocationController.list,
);
centreLocationRouter.post(
  '/',
  authorizePermission(P.CMS_CENTRE_LOCATIONS_CREATE),
  validateRequest(createCentreLocationSchema),
  centreLocationController.create,
);
centreLocationRouter.get(
  '/:id',
  authorizePermission(P.CMS_CENTRE_LOCATIONS_VIEW),
  validateRequest(centreLocationIdSchema),
  centreLocationController.get,
);
centreLocationRouter.put(
  '/:id',
  authorizePermission(P.CMS_CENTRE_LOCATIONS_UPDATE),
  validateRequest(updateCentreLocationSchema),
  centreLocationController.update,
);
centreLocationRouter.patch(
  '/:id',
  authorizePermission(P.CMS_CENTRE_LOCATIONS_UPDATE),
  validateRequest(updateCentreLocationSchema),
  centreLocationController.update,
);
centreLocationRouter.patch(
  '/:id/status',
  authorizePermission(P.CMS_CENTRE_LOCATIONS_UPDATE),
  validateRequest(centreLocationStatusSchema),
  centreLocationController.setStatus,
);
centreLocationRouter.delete(
  '/:id',
  authorizePermission(P.CMS_CENTRE_LOCATIONS_DELETE),
  validateRequest(centreLocationIdSchema),
  centreLocationController.remove,
);
centreLocationRouter.post(
  '/:id/restore',
  authorizePermission(P.CMS_CENTRE_LOCATIONS_DELETE),
  validateRequest(centreLocationIdSchema),
  centreLocationController.restore,
);
