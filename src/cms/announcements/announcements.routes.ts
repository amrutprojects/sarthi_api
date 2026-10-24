import { Router } from 'express';
import { P } from '../../modules/roles-permissions/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { idempotent } from '../../shared/idempotency/idempotency.middleware';
import { announcementsController } from './announcements.controller';
import {
  announcementIdSchema,
  announcementStatusSchema,
  createAnnouncementSchema,
  reorderSchema,
  updateAnnouncementSchema,
  updateSettingsSchema,
} from './announcements.validator';

/*
 * /api/v1/cms/announcements — "Announcements" (the scrolling ticker at the top of the website).
 *
 * authenticate() is applied once by the parent CMS router, and each route declares the permission it
 * needs. Creating an announcement honours the Idempotency-Key header (ADR-0005), so a retried or
 * double-submitted form replays the first response instead of adding the announcement twice.
 *
 * The static paths (/settings, /order) are declared before /:id so they are never taken for an id.
 */
export const announcementsRouter = Router();

announcementsRouter.get('/', authorizePermission(P.CMS_ANNOUNCEMENTS_VIEW), announcementsController.list);
announcementsRouter.post(
  '/',
  authorizePermission(P.CMS_ANNOUNCEMENTS_CREATE),
  validateRequest(createAnnouncementSchema),
  idempotent,
  announcementsController.create,
);

announcementsRouter.get('/settings', authorizePermission(P.CMS_ANNOUNCEMENTS_VIEW), announcementsController.getSettings);
announcementsRouter.put(
  '/settings',
  authorizePermission(P.CMS_ANNOUNCEMENTS_UPDATE),
  validateRequest(updateSettingsSchema),
  announcementsController.updateSettings,
);

announcementsRouter.put(
  '/order',
  authorizePermission(P.CMS_ANNOUNCEMENTS_UPDATE),
  validateRequest(reorderSchema),
  announcementsController.reorder,
);

announcementsRouter.get(
  '/:id',
  authorizePermission(P.CMS_ANNOUNCEMENTS_VIEW),
  validateRequest(announcementIdSchema),
  announcementsController.get,
);
announcementsRouter.patch(
  '/:id',
  authorizePermission(P.CMS_ANNOUNCEMENTS_UPDATE),
  validateRequest(updateAnnouncementSchema),
  announcementsController.update,
);
announcementsRouter.patch(
  '/:id/status',
  authorizePermission(P.CMS_ANNOUNCEMENTS_UPDATE),
  validateRequest(announcementStatusSchema),
  announcementsController.setStatus,
);
announcementsRouter.delete(
  '/:id',
  authorizePermission(P.CMS_ANNOUNCEMENTS_DELETE),
  validateRequest(announcementIdSchema),
  announcementsController.remove,
);
