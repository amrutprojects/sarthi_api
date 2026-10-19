import { Router } from 'express';
import { P } from '../../constants/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { parentIdParams } from '../../validators/common.validator';
import { districtController } from './district.controller';
import {
  createDistrictSchema, districtIdSchema, districtStatusSchema, listDistrictsSchema, updateDistrictSchema,
} from './district.validator';

/* /api/v1/cms/districts — District Master. See state.routes.ts for the shared conventions. */
export const districtRouter = Router();

districtRouter.get('/', authorizePermission(P.CMS_DISTRICTS_VIEW), validateRequest(listDistrictsSchema), districtController.list);
districtRouter.post('/', authorizePermission(P.CMS_DISTRICTS_CREATE), validateRequest(createDistrictSchema), districtController.create);
districtRouter.get('/:id', authorizePermission(P.CMS_DISTRICTS_VIEW), validateRequest(districtIdSchema), districtController.get);
districtRouter.put('/:id', authorizePermission(P.CMS_DISTRICTS_UPDATE), validateRequest(updateDistrictSchema), districtController.update);
districtRouter.patch('/:id', authorizePermission(P.CMS_DISTRICTS_UPDATE), validateRequest(updateDistrictSchema), districtController.update);
districtRouter.patch('/:id/status', authorizePermission(P.CMS_DISTRICTS_UPDATE), validateRequest(districtStatusSchema), districtController.setStatus);
districtRouter.delete('/:id', authorizePermission(P.CMS_DISTRICTS_DELETE), validateRequest(districtIdSchema), districtController.remove);
districtRouter.post('/:id/restore', authorizePermission(P.CMS_DISTRICTS_DELETE), validateRequest(districtIdSchema), districtController.restore);

/* Nested dropdown feed for the Taluka form. */
districtRouter.get(
  '/:districtId/talukas',
  authorizePermission(P.CMS_TALUKAS_VIEW),
  validateRequest({ params: parentIdParams('districtId') }),
  districtController.talukas,
);
