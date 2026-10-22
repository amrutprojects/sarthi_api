import { Router } from 'express';
import { P } from '../../modules/roles-permissions/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { faqController } from './faq.controller';
import { createFaqSchema, faqIdSchema, faqStatusSchema, listFaqsSchema, updateFaqSchema } from './faq.validator';

/*
 * /api/v1/cms/faqs — FAQ Management.
 *
 * authenticate() is applied once by the parent CMS router, and each route declares the permission it
 * needs, so a signed-in user without the CMS codes gets a 403 that authorizePermission also writes to
 * the audit log.
 *
 * PUT and PATCH both map to update, as on the State master.
 */
export const faqRouter = Router();

faqRouter.get('/', authorizePermission(P.CMS_FAQS_VIEW), validateRequest(listFaqsSchema), faqController.list);
faqRouter.post('/', authorizePermission(P.CMS_FAQS_CREATE), validateRequest(createFaqSchema), faqController.create);
faqRouter.get('/:id', authorizePermission(P.CMS_FAQS_VIEW), validateRequest(faqIdSchema), faqController.get);
faqRouter.put('/:id', authorizePermission(P.CMS_FAQS_UPDATE), validateRequest(updateFaqSchema), faqController.update);
faqRouter.patch('/:id', authorizePermission(P.CMS_FAQS_UPDATE), validateRequest(updateFaqSchema), faqController.update);
faqRouter.patch('/:id/status', authorizePermission(P.CMS_FAQS_UPDATE), validateRequest(faqStatusSchema), faqController.setStatus);
faqRouter.delete('/:id', authorizePermission(P.CMS_FAQS_DELETE), validateRequest(faqIdSchema), faqController.remove);
faqRouter.post('/:id/restore', authorizePermission(P.CMS_FAQS_DELETE), validateRequest(faqIdSchema), faqController.restore);
