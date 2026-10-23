import { Router } from 'express';
import { P } from '../../modules/roles-permissions/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { idempotent } from '../../shared/idempotency/idempotency.middleware';
import { schemesController } from './schemes.controller';
import {
  createSchemeSchema,
  reorderSchema,
  schemeIdSchema,
  schemeStatusSchema,
  updateSchemeSchema,
  updateSectionSchema,
} from './schemes.validator';

/*
 * /api/v1/cms/schemes — "AMRUT Schemes Management" (the अमृत योजना विभाग cards).
 *
 * authenticate() is applied once by the parent CMS router, and each route declares the permission it
 * needs. Creating a scheme honours the Idempotency-Key header (ADR-0005), so a retried or
 * double-submitted form replays the first response instead of adding the scheme twice.
 *
 * The static paths (/settings, /order) are declared before /:id so they are never taken for an id.
 */
export const schemesRouter = Router();

schemesRouter.get('/', authorizePermission(P.CMS_SCHEMES_VIEW), schemesController.list);
schemesRouter.post(
  '/',
  authorizePermission(P.CMS_SCHEMES_CREATE),
  validateRequest(createSchemeSchema),
  idempotent,
  schemesController.create,
);

schemesRouter.get('/settings', authorizePermission(P.CMS_SCHEMES_VIEW), schemesController.getSection);
schemesRouter.put(
  '/settings',
  authorizePermission(P.CMS_SCHEMES_UPDATE),
  validateRequest(updateSectionSchema),
  schemesController.updateSection,
);

schemesRouter.put('/order', authorizePermission(P.CMS_SCHEMES_UPDATE), validateRequest(reorderSchema), schemesController.reorder);

schemesRouter.get('/:id', authorizePermission(P.CMS_SCHEMES_VIEW), validateRequest(schemeIdSchema), schemesController.get);
schemesRouter.patch('/:id', authorizePermission(P.CMS_SCHEMES_UPDATE), validateRequest(updateSchemeSchema), schemesController.update);
schemesRouter.patch(
  '/:id/status',
  authorizePermission(P.CMS_SCHEMES_UPDATE),
  validateRequest(schemeStatusSchema),
  schemesController.setStatus,
);
schemesRouter.delete('/:id', authorizePermission(P.CMS_SCHEMES_DELETE), validateRequest(schemeIdSchema), schemesController.remove);
