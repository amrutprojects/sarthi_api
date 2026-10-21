import { Router } from 'express';
import { P } from '../../modules/roles-permissions';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { collegeController } from './college.controller';
import {
  collegeIdSchema, collegeStatusSchema, createCollegeSchema, listCollegesSchema, updateCollegeSchema,
} from './college.validator';

/* /api/v1/cms/colleges — College Master. See state.routes.ts for the shared conventions. */
export const collegeRouter = Router();

collegeRouter.get('/', authorizePermission(P.CMS_COLLEGES_VIEW), validateRequest(listCollegesSchema), collegeController.list);
/* Dropdown feed (active only). Registered before /:id so "options" is never read as an id. */
collegeRouter.get('/options', authorizePermission(P.CMS_COLLEGES_VIEW), collegeController.options);
collegeRouter.post('/', authorizePermission(P.CMS_COLLEGES_CREATE), validateRequest(createCollegeSchema), collegeController.create);
collegeRouter.get('/:id', authorizePermission(P.CMS_COLLEGES_VIEW), validateRequest(collegeIdSchema), collegeController.get);
collegeRouter.put('/:id', authorizePermission(P.CMS_COLLEGES_UPDATE), validateRequest(updateCollegeSchema), collegeController.update);
collegeRouter.patch('/:id', authorizePermission(P.CMS_COLLEGES_UPDATE), validateRequest(updateCollegeSchema), collegeController.update);
collegeRouter.patch('/:id/status', authorizePermission(P.CMS_COLLEGES_UPDATE), validateRequest(collegeStatusSchema), collegeController.setStatus);
collegeRouter.delete('/:id', authorizePermission(P.CMS_COLLEGES_DELETE), validateRequest(collegeIdSchema), collegeController.remove);
collegeRouter.post('/:id/restore', authorizePermission(P.CMS_COLLEGES_DELETE), validateRequest(collegeIdSchema), collegeController.restore);
