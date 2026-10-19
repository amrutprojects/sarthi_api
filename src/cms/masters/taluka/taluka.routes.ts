import { Router } from 'express';
import { P } from '../../../modules/roles-permissions/permission.constants';
import { authorizePermission } from '../../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../../middleware/validate-request.middleware';
import { talukaController } from './taluka.controller';
import {
  createTalukaSchema, listTalukasSchema, talukaIdSchema, talukaStatusSchema, updateTalukaSchema,
} from './taluka.validator';

/* /api/v1/cms/talukas — Taluka Master. See state.routes.ts for the shared conventions. */
export const talukaRouter = Router();

talukaRouter.get('/', authorizePermission(P.CMS_TALUKAS_VIEW), validateRequest(listTalukasSchema), talukaController.list);
talukaRouter.post('/', authorizePermission(P.CMS_TALUKAS_CREATE), validateRequest(createTalukaSchema), talukaController.create);
talukaRouter.get('/:id', authorizePermission(P.CMS_TALUKAS_VIEW), validateRequest(talukaIdSchema), talukaController.get);
talukaRouter.put('/:id', authorizePermission(P.CMS_TALUKAS_UPDATE), validateRequest(updateTalukaSchema), talukaController.update);
talukaRouter.patch('/:id', authorizePermission(P.CMS_TALUKAS_UPDATE), validateRequest(updateTalukaSchema), talukaController.update);
talukaRouter.patch('/:id/status', authorizePermission(P.CMS_TALUKAS_UPDATE), validateRequest(talukaStatusSchema), talukaController.setStatus);
talukaRouter.delete('/:id', authorizePermission(P.CMS_TALUKAS_DELETE), validateRequest(talukaIdSchema), talukaController.remove);
talukaRouter.post('/:id/restore', authorizePermission(P.CMS_TALUKAS_DELETE), validateRequest(talukaIdSchema), talukaController.restore);
