import { Router } from 'express';
import { P } from '../permission.constants';
import { roleController } from './role.controller';
import { authenticate } from '../../../middleware/authenticate.middleware';
import { authorizePermission } from '../../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../../middleware/validate-request.middleware';
import {
  createRoleSchema, listRolesSchema, replaceRolePermissionsSchema, roleIdSchema, roleStatusSchema, updateRoleSchema,
} from './role.validation';

export const roleRouter = Router();

roleRouter.use(authenticate);

roleRouter.get('/', authorizePermission(P.ROLES_VIEW), validateRequest(listRolesSchema), roleController.list);
roleRouter.post('/', authorizePermission(P.ROLES_CREATE), validateRequest(createRoleSchema), roleController.create);
roleRouter.get('/:id', authorizePermission(P.ROLES_VIEW), validateRequest(roleIdSchema), roleController.get);
roleRouter.patch('/:id', authorizePermission(P.ROLES_UPDATE), validateRequest(updateRoleSchema), roleController.update);
roleRouter.patch('/:id/status', authorizePermission(P.ROLES_UPDATE), validateRequest(roleStatusSchema), roleController.setStatus);
roleRouter.delete('/:id', authorizePermission(P.ROLES_DELETE), validateRequest(roleIdSchema), roleController.remove);
roleRouter.post('/:id/restore', authorizePermission(P.ROLES_RESTORE), validateRequest(roleIdSchema), roleController.restore);
roleRouter.get('/:id/permissions', authorizePermission([P.ROLES_VIEW, P.PERMISSIONS_VIEW]), validateRequest(roleIdSchema), roleController.getPermissions);
roleRouter.put('/:id/permissions', authorizePermission(P.PERMISSIONS_ASSIGN), validateRequest(replaceRolePermissionsSchema), roleController.replacePermissions);
