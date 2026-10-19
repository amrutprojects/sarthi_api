import { Router } from 'express';
import { P } from '../../modules/roles-permissions/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { footerController } from './footer.controller';
import { footerStatusSchema, updateFooterSchema } from './footer.validator';

/*
 * /api/v1/cms/footer — Footer Management.
 *
 * authenticate() is applied once by the parent CMS router, and each route declares the permission
 * it needs, so a signed-in user without the CMS codes gets a 403 that authorizePermission also
 * writes to the audit log.
 *
 * No POST and no DELETE: the footer is a database-enforced singleton created by the seed. PUT
 * replaces the whole footer (text, columns and links) in one transaction, which is what the admin
 * screen submits; PATCH /status changes only visibility.
 */
export const footerRouter = Router();

footerRouter.get('/', authorizePermission(P.CMS_FOOTER_VIEW), footerController.get);
footerRouter.put('/', authorizePermission(P.CMS_FOOTER_UPDATE), validateRequest(updateFooterSchema), footerController.update);
footerRouter.patch('/status', authorizePermission(P.CMS_FOOTER_UPDATE), validateRequest(footerStatusSchema), footerController.setPublished);
