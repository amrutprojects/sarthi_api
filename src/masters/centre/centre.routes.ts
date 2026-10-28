import { Router } from 'express';
import { P } from '../../modules/roles-permissions';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { centreController } from './centre.controller';
import { centreIdSchema, centreStatusSchema, createCentreSchema, listCentresSchema, updateCentreSchema } from './centre.validator';

/* /api/v1/cms/centres — Center Master. Same conventions as college.routes.ts. */
export const centreRouter = Router();

centreRouter.get('/', authorizePermission(P.CMS_CENTRES_VIEW), validateRequest(listCentresSchema), centreController.list);
/* Dropdown feeds. Registered before /:id so "options" is never read as an id. */
centreRouter.get('/options', authorizePermission(P.CMS_CENTRES_VIEW), centreController.options);
centreRouter.get('/technology-options', authorizePermission(P.CMS_CENTRES_VIEW), centreController.technologyOptions);
centreRouter.post('/', authorizePermission(P.CMS_CENTRES_CREATE), validateRequest(createCentreSchema), centreController.create);
centreRouter.get('/:id', authorizePermission(P.CMS_CENTRES_VIEW), validateRequest(centreIdSchema), centreController.get);
centreRouter.put('/:id', authorizePermission(P.CMS_CENTRES_UPDATE), validateRequest(updateCentreSchema), centreController.update);
centreRouter.patch('/:id', authorizePermission(P.CMS_CENTRES_UPDATE), validateRequest(updateCentreSchema), centreController.update);
centreRouter.patch(
  '/:id/status',
  authorizePermission(P.CMS_CENTRES_UPDATE),
  validateRequest(centreStatusSchema),
  centreController.setStatus,
);
centreRouter.delete('/:id', authorizePermission(P.CMS_CENTRES_DELETE), validateRequest(centreIdSchema), centreController.remove);
centreRouter.post('/:id/restore', authorizePermission(P.CMS_CENTRES_DELETE), validateRequest(centreIdSchema), centreController.restore);
