import { Router } from 'express';
import { P } from '../../modules/roles-permissions/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { idempotent } from '../../shared/idempotency/idempotency.middleware';
import { ecosystemController } from './ecosystem.controller';
import {
  createProgrammeSchema,
  programmeIdSchema,
  programmeStatusSchema,
  reorderSchema,
  updateProgrammeSchema,
  updateSectionSchema,
} from './ecosystem.validator';

/*
 * /api/v1/cms/ecosystem — "The AMRUT Ecosystem" (the अमृत प्रणाली cards).
 *
 * authenticate() is applied once by the parent CMS router, and each route declares the permission it
 * needs. Creating a card honours the Idempotency-Key header (ADR-0005), so a retried or
 * double-submitted form replays the first response instead of adding the card twice.
 *
 * The static paths (/settings, /order) are declared before /:id so they are never taken for an id.
 */
export const ecosystemRouter = Router();

ecosystemRouter.get('/', authorizePermission(P.CMS_ECOSYSTEM_VIEW), ecosystemController.list);
ecosystemRouter.post(
  '/',
  authorizePermission(P.CMS_ECOSYSTEM_CREATE),
  validateRequest(createProgrammeSchema),
  idempotent,
  ecosystemController.create,
);

ecosystemRouter.get('/settings', authorizePermission(P.CMS_ECOSYSTEM_VIEW), ecosystemController.getSection);
ecosystemRouter.put('/settings', authorizePermission(P.CMS_ECOSYSTEM_UPDATE), validateRequest(updateSectionSchema), ecosystemController.updateSection);

ecosystemRouter.put('/order', authorizePermission(P.CMS_ECOSYSTEM_UPDATE), validateRequest(reorderSchema), ecosystemController.reorder);

ecosystemRouter.get('/:id', authorizePermission(P.CMS_ECOSYSTEM_VIEW), validateRequest(programmeIdSchema), ecosystemController.get);
ecosystemRouter.patch('/:id', authorizePermission(P.CMS_ECOSYSTEM_UPDATE), validateRequest(updateProgrammeSchema), ecosystemController.update);
ecosystemRouter.patch(
  '/:id/status',
  authorizePermission(P.CMS_ECOSYSTEM_UPDATE),
  validateRequest(programmeStatusSchema),
  ecosystemController.setStatus,
);
ecosystemRouter.delete('/:id', authorizePermission(P.CMS_ECOSYSTEM_DELETE), validateRequest(programmeIdSchema), ecosystemController.remove);
