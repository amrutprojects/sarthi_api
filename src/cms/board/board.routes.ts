import { Router } from 'express';
import { P } from '../../modules/roles-permissions/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { boardController } from './board.controller';
import { receivePhoto } from './board.photo';
import {
  createMemberSchema,
  memberIdSchema,
  memberStatusSchema,
  photoFileSchema,
  reorderSchema,
  updateMemberSchema,
  updateSectionSchema,
} from './board.validator';

/*
 * /api/v1/cms/board-members — the Leadership & Governing Board section (Board Members Management).
 *
 * authenticate() is applied once by the parent CMS router, and each route declares the permission it
 * needs. The permission check runs BEFORE receivePhoto(), so an upload from someone who may not write
 * here is refused without being read.
 *
 * The static paths (/settings, /order, /photos/…) are declared before /:id so they are never taken
 * for a member id.
 */
export const boardRouter = Router();

boardRouter.get('/', authorizePermission(P.CMS_BOARD_VIEW), boardController.list);
boardRouter.post('/', authorizePermission(P.CMS_BOARD_CREATE), receivePhoto, validateRequest(createMemberSchema), boardController.create);

boardRouter.get('/settings', authorizePermission(P.CMS_BOARD_VIEW), boardController.getSection);
boardRouter.put('/settings', authorizePermission(P.CMS_BOARD_UPDATE), validateRequest(updateSectionSchema), boardController.updateSection);

boardRouter.put('/order', authorizePermission(P.CMS_BOARD_UPDATE), validateRequest(reorderSchema), boardController.reorder);

/* Any member's photo, hidden members included, for the admin list and form. */
boardRouter.get('/photos/:file', authorizePermission(P.CMS_BOARD_VIEW), validateRequest(photoFileSchema), boardController.adminPhoto);

boardRouter.get('/:id', authorizePermission(P.CMS_BOARD_VIEW), validateRequest(memberIdSchema), boardController.get);
boardRouter.patch(
  '/:id',
  authorizePermission(P.CMS_BOARD_UPDATE),
  receivePhoto,
  validateRequest(updateMemberSchema),
  boardController.update,
);
boardRouter.patch('/:id/status', authorizePermission(P.CMS_BOARD_UPDATE), validateRequest(memberStatusSchema), boardController.setStatus);
boardRouter.delete('/:id', authorizePermission(P.CMS_BOARD_DELETE), validateRequest(memberIdSchema), boardController.remove);
