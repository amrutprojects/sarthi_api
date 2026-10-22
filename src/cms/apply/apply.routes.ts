import { Router } from 'express';
import { P } from '../../modules/roles-permissions/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { applyController } from './apply.controller';
import {
  applyItemIdSchema,
  applyItemStatusSchema,
  createApplyItemSchema,
  listApplyItemsSchema,
  updateApplyItemSchema,
  updateApplySettingsSchema,
} from './apply.validator';

/*
 * /api/v1/cms/apply — Apply Page Management.
 *
 * authenticate() is applied once by the parent CMS router, and each route declares the permission it
 * needs, so a signed-in user without the CMS codes gets a 403 that authorizePermission also writes to
 * the audit log.
 *
 * /settings is the page text, a singleton created by the migration: GET and PUT only, no POST and
 * no DELETE (GET takes no input, so it has nothing to validate). /items are the application steps
 * and the "At a glance" rows, with the usual master lifecycle; PUT and PATCH both map to update, as
 * on the State master, and restoring a soft-deleted row is guarded by the `.delete` code.
 *
 * The "Documents to keep ready" list has no route here: it is the Eligibility page's documents,
 * managed under /cms/eligibility.
 */
export const applyRouter = Router();

applyRouter.get('/settings', authorizePermission(P.CMS_APPLY_VIEW), applyController.getSettings);
applyRouter.put(
  '/settings',
  authorizePermission(P.CMS_APPLY_UPDATE),
  validateRequest(updateApplySettingsSchema),
  applyController.updateSettings,
);

applyRouter.get('/items', authorizePermission(P.CMS_APPLY_VIEW), validateRequest(listApplyItemsSchema), applyController.list);
applyRouter.post('/items', authorizePermission(P.CMS_APPLY_CREATE), validateRequest(createApplyItemSchema), applyController.create);
applyRouter.get('/items/:id', authorizePermission(P.CMS_APPLY_VIEW), validateRequest(applyItemIdSchema), applyController.get);
applyRouter.put('/items/:id', authorizePermission(P.CMS_APPLY_UPDATE), validateRequest(updateApplyItemSchema), applyController.update);
applyRouter.patch('/items/:id', authorizePermission(P.CMS_APPLY_UPDATE), validateRequest(updateApplyItemSchema), applyController.update);
applyRouter.patch(
  '/items/:id/status',
  authorizePermission(P.CMS_APPLY_UPDATE),
  validateRequest(applyItemStatusSchema),
  applyController.setStatus,
);
applyRouter.delete('/items/:id', authorizePermission(P.CMS_APPLY_DELETE), validateRequest(applyItemIdSchema), applyController.remove);
applyRouter.post(
  '/items/:id/restore',
  authorizePermission(P.CMS_APPLY_DELETE),
  validateRequest(applyItemIdSchema),
  applyController.restore,
);
