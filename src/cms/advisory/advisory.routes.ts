import { Router } from 'express';
import { P } from '../../modules/roles-permissions/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { advisoryController } from './advisory.controller';
import { receivePhoto } from './advisory.photo';
import {
  createGroupSchema,
  createMemberSchema,
  groupIdSchema,
  groupOrderSchema,
  groupStatusSchema,
  memberIdSchema,
  memberStatusSchema,
  photoFileSchema,
  reorderSchema,
  updateGroupSchema,
  updateMemberSchema,
  updateSectionSchema,
} from './advisory.validator';

/*
 * /api/v1/cms/advisory-committee — the Sarthi Advisory Committee page (Advisory Committee
 * Management).
 *
 * authenticate() is applied once by the parent CMS router, and each route declares the permission it
 * needs. The permission check runs BEFORE receivePhoto(), so an upload from someone who may not write
 * here is refused without being read.
 *
 * The static paths (/settings, /order, /groups…, /photos/…) are declared before /:id so they are never
 * taken for a member id; likewise /groups/order before /groups/:id.
 */
export const advisoryRouter = Router();

advisoryRouter.get('/', authorizePermission(P.CMS_ADVISORY_VIEW), advisoryController.list);
advisoryRouter.post(
  '/',
  authorizePermission(P.CMS_ADVISORY_CREATE),
  receivePhoto,
  validateRequest(createMemberSchema),
  advisoryController.create,
);

advisoryRouter.get('/settings', authorizePermission(P.CMS_ADVISORY_VIEW), advisoryController.getSection);
advisoryRouter.put(
  '/settings',
  authorizePermission(P.CMS_ADVISORY_UPDATE),
  validateRequest(updateSectionSchema),
  advisoryController.updateSection,
);

advisoryRouter.put('/order', authorizePermission(P.CMS_ADVISORY_UPDATE), validateRequest(reorderSchema), advisoryController.reorder);

/* Groups: the headings members are listed under on the website. Same permissions as the members. */
advisoryRouter.get('/groups', authorizePermission(P.CMS_ADVISORY_VIEW), advisoryController.listGroups);
advisoryRouter.post(
  '/groups',
  authorizePermission(P.CMS_ADVISORY_CREATE),
  validateRequest(createGroupSchema),
  advisoryController.createGroup,
);
advisoryRouter.put(
  '/groups/order',
  authorizePermission(P.CMS_ADVISORY_UPDATE),
  validateRequest(groupOrderSchema),
  advisoryController.reorderGroups,
);
advisoryRouter.get('/groups/:id', authorizePermission(P.CMS_ADVISORY_VIEW), validateRequest(groupIdSchema), advisoryController.getGroup);
advisoryRouter.patch(
  '/groups/:id',
  authorizePermission(P.CMS_ADVISORY_UPDATE),
  validateRequest(updateGroupSchema),
  advisoryController.updateGroup,
);
advisoryRouter.patch(
  '/groups/:id/status',
  authorizePermission(P.CMS_ADVISORY_UPDATE),
  validateRequest(groupStatusSchema),
  advisoryController.setGroupStatus,
);
advisoryRouter.delete(
  '/groups/:id',
  authorizePermission(P.CMS_ADVISORY_DELETE),
  validateRequest(groupIdSchema),
  advisoryController.removeGroup,
);

/* Any member's photo, hidden members included, for the admin list and form. */
advisoryRouter.get(
  '/photos/:file',
  authorizePermission(P.CMS_ADVISORY_VIEW),
  validateRequest(photoFileSchema),
  advisoryController.adminPhoto,
);

advisoryRouter.get('/:id', authorizePermission(P.CMS_ADVISORY_VIEW), validateRequest(memberIdSchema), advisoryController.get);
advisoryRouter.patch(
  '/:id',
  authorizePermission(P.CMS_ADVISORY_UPDATE),
  receivePhoto,
  validateRequest(updateMemberSchema),
  advisoryController.update,
);
advisoryRouter.patch(
  '/:id/status',
  authorizePermission(P.CMS_ADVISORY_UPDATE),
  validateRequest(memberStatusSchema),
  advisoryController.setStatus,
);
advisoryRouter.delete('/:id', authorizePermission(P.CMS_ADVISORY_DELETE), validateRequest(memberIdSchema), advisoryController.remove);
