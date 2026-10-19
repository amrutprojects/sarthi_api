import { idempotent } from '../../shared/idempotency/idempotency.middleware';
import { Router } from 'express';
import { P } from '../roles-permissions';
import { userController } from './user.controller';
import { authenticate } from '../../middleware/authenticate.middleware';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import {
  createUserSchema, listUsersSchema, replaceUserRolesSchema, updateUserSchema, userIdSchema, userStatusSchema,
} from './user.validation';

export const userRouter = Router();

/* Every user route requires authentication; each then requires its own permission. */
userRouter.use(authenticate);

userRouter.get('/', authorizePermission(P.USERS_VIEW), validateRequest(listUsersSchema), userController.list);
userRouter.post('/', authorizePermission(P.USERS_CREATE), validateRequest(createUserSchema), idempotent, userController.create);
userRouter.get('/:id', authorizePermission(P.USERS_VIEW), validateRequest(userIdSchema), userController.get);
userRouter.patch('/:id', authorizePermission(P.USERS_UPDATE), validateRequest(updateUserSchema), userController.update);
userRouter.patch('/:id/status', authorizePermission(P.USERS_UPDATE), validateRequest(userStatusSchema), userController.setStatus);
userRouter.delete('/:id', authorizePermission(P.USERS_DELETE), validateRequest(userIdSchema), userController.remove);
userRouter.post('/:id/restore', authorizePermission(P.USERS_RESTORE), validateRequest(userIdSchema), userController.restore);
userRouter.get('/:id/roles', authorizePermission([P.USERS_VIEW, P.ROLES_VIEW]), validateRequest(userIdSchema), userController.getRoles);
userRouter.put('/:id/roles', authorizePermission(P.USERS_ASSIGN_ROLES), validateRequest(replaceUserRolesSchema), userController.replaceRoles);
