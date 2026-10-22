import { Router } from 'express';
import { P } from '../../modules/roles-permissions';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { centreTypeController } from './centre-type.controller';
import {
  centreTypeIdSchema, centreTypeStatusSchema, createCentreTypeSchema, listCentreTypesSchema, updateCentreTypeSchema,
} from './centre-type.validator';

/* /api/v1/cms/centre-types — Training Centre Type Master. See state.routes.ts for the shared conventions. */
export const centreTypeRouter = Router();

centreTypeRouter.get('/', authorizePermission(P.CMS_CENTRE_TYPES_VIEW), validateRequest(listCentreTypesSchema), centreTypeController.list);
/*
 * Dropdown feed (active only), also readable by Training Centre Master users, who pick a type in the
 * centre form. Registered before /:id so "options" is never read as an id.
 */
centreTypeRouter.get(
  '/options',
  authorizePermission([P.CMS_CENTRE_TYPES_VIEW, P.CMS_TRAINING_CENTRES_VIEW], { any: true }),
  centreTypeController.options,
);
centreTypeRouter.post('/', authorizePermission(P.CMS_CENTRE_TYPES_CREATE), validateRequest(createCentreTypeSchema), centreTypeController.create);
centreTypeRouter.get('/:id', authorizePermission(P.CMS_CENTRE_TYPES_VIEW), validateRequest(centreTypeIdSchema), centreTypeController.get);
centreTypeRouter.put('/:id', authorizePermission(P.CMS_CENTRE_TYPES_UPDATE), validateRequest(updateCentreTypeSchema), centreTypeController.update);
centreTypeRouter.patch('/:id', authorizePermission(P.CMS_CENTRE_TYPES_UPDATE), validateRequest(updateCentreTypeSchema), centreTypeController.update);
centreTypeRouter.patch(
  '/:id/status',
  authorizePermission(P.CMS_CENTRE_TYPES_UPDATE),
  validateRequest(centreTypeStatusSchema),
  centreTypeController.setStatus,
);
centreTypeRouter.delete('/:id', authorizePermission(P.CMS_CENTRE_TYPES_DELETE), validateRequest(centreTypeIdSchema), centreTypeController.remove);
centreTypeRouter.post(
  '/:id/restore',
  authorizePermission(P.CMS_CENTRE_TYPES_DELETE),
  validateRequest(centreTypeIdSchema),
  centreTypeController.restore,
);
