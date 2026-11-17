import { Router } from 'express';
import { P } from '../../modules/roles-permissions/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { contactController } from './contact.controller';
import {
  contactItemIdSchema,
  contactItemStatusSchema,
  contactStatusSchema,
  createCoordinatorSchema,
  createDistrictOfficeSchema,
  districtOfficesSectionSchema,
  listCoordinatorsSchema,
  listDistrictOfficesSchema,
  updateContactPageSchema,
  updateCoordinatorSchema,
  updateDistrictOfficeSchema,
} from './contact.validator';

/*
 * /api/v1/cms/contact — Contact Page Management.
 *
 * authenticate() is applied once by the parent masters router, and each route declares the
 * permission it needs, so a signed-in user without the CMS codes gets a 403 that authorizePermission
 * also writes to the audit log.
 *
 * No POST and no DELETE on the page itself: the configuration is a database-enforced singleton
 * created by the seed. PUT replaces the whole page (banner plus cards) in one transaction; PATCH
 * /status changes only visibility.
 *
 * The coordinator and district office sections are also edited one entry at a time under
 * /coordinators and /district-offices. Every write there needs cms-contact.update, not create /
 * delete codes: those entries are part of the one Contact page, and the page's permissions are view
 * and update only (which is all the Website Admin role holds).
 */
export const contactRouter = Router();

contactRouter.get('/', authorizePermission(P.CMS_CONTACT_VIEW), contactController.get);
contactRouter.put('/', authorizePermission(P.CMS_CONTACT_UPDATE), validateRequest(updateContactPageSchema), contactController.update);
contactRouter.patch(
  '/status',
  authorizePermission(P.CMS_CONTACT_UPDATE),
  validateRequest(contactStatusSchema),
  contactController.setPublished,
);
/* The "District offices" section's "Show on website" switch: only that flag changes. */
contactRouter.patch(
  '/district-offices-section',
  authorizePermission(P.CMS_CONTACT_UPDATE),
  validateRequest(districtOfficesSectionSchema),
  contactController.setDistrictOfficesSection,
);

const view = authorizePermission(P.CMS_CONTACT_VIEW);
const update = authorizePermission(P.CMS_CONTACT_UPDATE);

contactRouter.get('/coordinators', view, validateRequest(listCoordinatorsSchema), contactController.listCoordinators);
contactRouter.post('/coordinators', update, validateRequest(createCoordinatorSchema), contactController.createCoordinator);
contactRouter.get('/coordinators/:id', view, validateRequest(contactItemIdSchema), contactController.getCoordinator);
contactRouter.patch('/coordinators/:id', update, validateRequest(updateCoordinatorSchema), contactController.updateCoordinator);
contactRouter.patch('/coordinators/:id/status', update, validateRequest(contactItemStatusSchema), contactController.setCoordinatorStatus);
contactRouter.delete('/coordinators/:id', update, validateRequest(contactItemIdSchema), contactController.removeCoordinator);

contactRouter.get('/district-offices', view, validateRequest(listDistrictOfficesSchema), contactController.listDistrictOffices);
contactRouter.post('/district-offices', update, validateRequest(createDistrictOfficeSchema), contactController.createDistrictOffice);
contactRouter.get('/district-offices/:id', view, validateRequest(contactItemIdSchema), contactController.getDistrictOffice);
contactRouter.patch('/district-offices/:id', update, validateRequest(updateDistrictOfficeSchema), contactController.updateDistrictOffice);
contactRouter.patch(
  '/district-offices/:id/status',
  update,
  validateRequest(contactItemStatusSchema),
  contactController.setDistrictOfficeStatus,
);
contactRouter.delete('/district-offices/:id', update, validateRequest(contactItemIdSchema), contactController.removeDistrictOffice);
