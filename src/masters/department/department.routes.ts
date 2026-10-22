import { Router } from 'express';
import { P } from '../../modules/roles-permissions';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { departmentController } from './department.controller';
import {
  createDepartmentSchema, departmentIdSchema, departmentStatusSchema, listDepartmentsSchema, updateDepartmentSchema,
} from './department.validator';

/* /api/v1/cms/departments — Department Master. See state.routes.ts for the shared conventions. */
export const departmentRouter = Router();

departmentRouter.get('/', authorizePermission(P.CMS_DEPARTMENTS_VIEW), validateRequest(listDepartmentsSchema), departmentController.list);
/* Dropdown feed (active only). Registered before /:id so "options" is never read as an id. */
departmentRouter.get('/options', authorizePermission(P.CMS_DEPARTMENTS_VIEW), departmentController.options);
departmentRouter.post('/', authorizePermission(P.CMS_DEPARTMENTS_CREATE), validateRequest(createDepartmentSchema), departmentController.create);
departmentRouter.get('/:id', authorizePermission(P.CMS_DEPARTMENTS_VIEW), validateRequest(departmentIdSchema), departmentController.get);
departmentRouter.put('/:id', authorizePermission(P.CMS_DEPARTMENTS_UPDATE), validateRequest(updateDepartmentSchema), departmentController.update);
departmentRouter.patch('/:id', authorizePermission(P.CMS_DEPARTMENTS_UPDATE), validateRequest(updateDepartmentSchema), departmentController.update);
departmentRouter.patch(
  '/:id/status',
  authorizePermission(P.CMS_DEPARTMENTS_UPDATE),
  validateRequest(departmentStatusSchema),
  departmentController.setStatus,
);
departmentRouter.delete('/:id', authorizePermission(P.CMS_DEPARTMENTS_DELETE), validateRequest(departmentIdSchema), departmentController.remove);
departmentRouter.post('/:id/restore', authorizePermission(P.CMS_DEPARTMENTS_DELETE), validateRequest(departmentIdSchema), departmentController.restore);
