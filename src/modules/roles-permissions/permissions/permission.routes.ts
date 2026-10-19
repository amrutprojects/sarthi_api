import { idempotent } from '../../../shared/idempotency/idempotency.middleware';
import { Router } from 'express';
import { P } from '../permission.constants';
import { permissionController } from './permission.controller';
import { authenticate } from '../../../middleware/authenticate.middleware';
import { authorizePermission } from '../../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../../middleware/validate-request.middleware';
import {
  createPermissionSchema, listPermissionsSchema, permissionIdSchema, permissionStatusSchema, updatePermissionSchema,
} from './permission.validation';

export const permissionRouter = Router();

permissionRouter.use(authenticate);

permissionRouter.get('/', authorizePermission(P.PERMISSIONS_VIEW), validateRequest(listPermissionsSchema), permissionController.list);
permissionRouter.get('/modules', authorizePermission(P.PERMISSIONS_VIEW), permissionController.modules);
permissionRouter.post('/', authorizePermission(P.PERMISSIONS_CREATE), validateRequest(createPermissionSchema), idempotent, permissionController.create);
permissionRouter.get('/:id', authorizePermission(P.PERMISSIONS_VIEW), validateRequest(permissionIdSchema), permissionController.get);
permissionRouter.patch('/:id', authorizePermission(P.PERMISSIONS_UPDATE), validateRequest(updatePermissionSchema), permissionController.update);
permissionRouter.patch('/:id/status', authorizePermission(P.PERMISSIONS_UPDATE), validateRequest(permissionStatusSchema), permissionController.setStatus);
permissionRouter.delete('/:id', authorizePermission(P.PERMISSIONS_DELETE), validateRequest(permissionIdSchema), permissionController.remove);
permissionRouter.post('/:id/restore', authorizePermission(P.PERMISSIONS_RESTORE), validateRequest(permissionIdSchema), permissionController.restore);
