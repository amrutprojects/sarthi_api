import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ERROR_CODES, HTTP_STATUS, RESPONSE_MESSAGES } from '../../../constants/api-response.constants';
import { appConfig } from '../../../config/app.config';
import { validateRequest } from '../../../middleware/validate-request.middleware';
import { ApiResponse } from '../../../utils/api-response';
import { registrationController } from './registration.controller';
import { createRegistrationSchema } from './registration.validation';
import { authenticate } from '../../../middleware/authenticate.middleware';
import { authorizePermission } from '../../../middleware/authorize-permission.middleware';
import { registrationAdminController } from './registration-admin.controller';
import {
  editRegistrationSchema,
  listRegistrationsSchema,
  registrationDocumentSchema,
  registrationIdSchema,
  registrationStatusSchema,
} from './registration-admin.validation';
import { receiveRegistrationUpload } from './registration-upload.middleware';

/* Per-IP limit for the public endpoint, on top of the global API limit. */
const registrationLimiter = rateLimit({
  windowMs: appConfig.rateLimit.windowMs,
  limit: appConfig.rateLimit.registrationMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    ApiResponse.error(res, HTTP_STATUS.TOO_MANY_REQUESTS, RESPONSE_MESSAGES.TOO_MANY_REQUESTS, ERROR_CODES.RATE_LIMITED);
  },
});

/* Public student registration (website). No authentication; it exposes no admin data and cannot approve. */
export const registrationRouter = Router();
registrationRouter.post('/', registrationLimiter, validateRequest(createRegistrationSchema), registrationController.create);

/* Student Registration menu (admin panel): registrations.view / registrations.create. */
registrationRouter.get(
  '/',
  authenticate,
  authorizePermission('registrations.view'),
  validateRequest(listRegistrationsSchema),
  registrationAdminController.list,
);
registrationRouter.post(
  '/admin',
  authenticate,
  authorizePermission('registrations.create'),
  receiveRegistrationUpload,
  registrationAdminController.create,
);
registrationRouter.get(
  '/:id',
  authenticate,
  authorizePermission('registrations.view'),
  validateRequest(registrationIdSchema),
  registrationAdminController.get,
);
registrationRouter.get(
  '/:id/documents/:documentId/file',
  authenticate,
  authorizePermission('registrations.view'),
  validateRequest(registrationDocumentSchema),
  registrationAdminController.documentFile,
);
registrationRouter.post(
  '/:id/documents/:documentId/verify',
  authenticate,
  authorizePermission('registrations.update'),
  validateRequest(registrationDocumentSchema),
  registrationAdminController.verifyDocument,
);
registrationRouter.patch(
  '/:id',
  authenticate,
  authorizePermission('registrations.update'),
  validateRequest(editRegistrationSchema),
  registrationAdminController.update,
);
registrationRouter.patch(
  '/:id/status',
  authenticate,
  authorizePermission('registrations.update'),
  validateRequest(registrationStatusSchema),
  registrationAdminController.setStatus,
);
registrationRouter.delete(
  '/:id',
  authenticate,
  authorizePermission('registrations.delete'),
  validateRequest(registrationIdSchema),
  registrationAdminController.remove,
);
registrationRouter.post(
  '/:id/documents',
  authenticate,
  authorizePermission('registrations.update'),
  validateRequest(registrationIdSchema),
  receiveRegistrationUpload,
  registrationAdminController.replaceDocuments,
);
