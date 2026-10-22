import { Router } from 'express';
import { P } from '../../modules/roles-permissions/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { eligibilityController } from './eligibility.controller';
import {
  createEligibilityItemSchema,
  eligibilityItemIdSchema,
  eligibilityItemStatusSchema,
  listEligibilityItemsSchema,
  updateEligibilityItemSchema,
  updateEligibilitySettingsSchema,
} from './eligibility.validator';

/*
 * /api/v1/cms/eligibility — Eligibility Page Management.
 *
 * authenticate() is applied once by the parent CMS router, and each route declares the permission it
 * needs, so a signed-in user without the CMS codes gets a 403 that authorizePermission also writes to
 * the audit log.
 *
 * /settings is the page text, a singleton created by the migration: GET and PUT only, no POST and
 * no DELETE (GET takes no input, so it has nothing to validate). /items are the criteria and the
 * required documents, with the usual master lifecycle; PUT and PATCH both map to update, as on the
 * State master, and restoring a soft-deleted row is guarded by the `.delete` code.
 */
export const eligibilityRouter = Router();

eligibilityRouter.get('/settings', authorizePermission(P.CMS_ELIGIBILITY_VIEW), eligibilityController.getSettings);
eligibilityRouter.put(
  '/settings',
  authorizePermission(P.CMS_ELIGIBILITY_UPDATE),
  validateRequest(updateEligibilitySettingsSchema),
  eligibilityController.updateSettings,
);

eligibilityRouter.get(
  '/items',
  authorizePermission(P.CMS_ELIGIBILITY_VIEW),
  validateRequest(listEligibilityItemsSchema),
  eligibilityController.list,
);
eligibilityRouter.post(
  '/items',
  authorizePermission(P.CMS_ELIGIBILITY_CREATE),
  validateRequest(createEligibilityItemSchema),
  eligibilityController.create,
);
eligibilityRouter.get(
  '/items/:id',
  authorizePermission(P.CMS_ELIGIBILITY_VIEW),
  validateRequest(eligibilityItemIdSchema),
  eligibilityController.get,
);
eligibilityRouter.put(
  '/items/:id',
  authorizePermission(P.CMS_ELIGIBILITY_UPDATE),
  validateRequest(updateEligibilityItemSchema),
  eligibilityController.update,
);
eligibilityRouter.patch(
  '/items/:id',
  authorizePermission(P.CMS_ELIGIBILITY_UPDATE),
  validateRequest(updateEligibilityItemSchema),
  eligibilityController.update,
);
eligibilityRouter.patch(
  '/items/:id/status',
  authorizePermission(P.CMS_ELIGIBILITY_UPDATE),
  validateRequest(eligibilityItemStatusSchema),
  eligibilityController.setStatus,
);
eligibilityRouter.delete(
  '/items/:id',
  authorizePermission(P.CMS_ELIGIBILITY_DELETE),
  validateRequest(eligibilityItemIdSchema),
  eligibilityController.remove,
);
eligibilityRouter.post(
  '/items/:id/restore',
  authorizePermission(P.CMS_ELIGIBILITY_DELETE),
  validateRequest(eligibilityItemIdSchema),
  eligibilityController.restore,
);
