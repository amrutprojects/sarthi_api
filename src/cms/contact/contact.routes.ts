import { Router } from 'express';
import { P } from '../../modules/roles-permissions/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { contactController } from './contact.controller';
import { contactStatusSchema, updateContactPageSchema } from './contact.validator';

/*
 * /api/v1/cms/contact — Contact Page Management.
 *
 * authenticate() is applied once by the parent masters router, and each route declares the
 * permission it needs, so a signed-in user without the CMS codes gets a 403 that authorizePermission
 * also writes to the audit log.
 *
 * No POST and no DELETE: the configuration is a database-enforced singleton created by the seed.
 * PUT replaces the whole page (banner plus cards) in one transaction, which is what the admin screen
 * submits; PATCH /status changes only visibility.
 */
export const contactRouter = Router();

contactRouter.get('/', authorizePermission(P.CMS_CONTACT_VIEW), contactController.get);
contactRouter.put('/', authorizePermission(P.CMS_CONTACT_UPDATE), validateRequest(updateContactPageSchema), contactController.update);
contactRouter.patch('/status', authorizePermission(P.CMS_CONTACT_UPDATE), validateRequest(contactStatusSchema), contactController.setPublished);
