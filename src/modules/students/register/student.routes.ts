import { Router } from 'express';
import { authenticate } from '../../../middleware/authenticate.middleware';
import { authorizePermission } from '../../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../../middleware/validate-request.middleware';
import { studentController } from './student.controller';
import { listStudentsSchema, studentDocumentSchema, studentIdSchema } from './student.validation';

/* Student register (A-18): read-only and masked; students are created only by import finalisation. */
export const studentRouter = Router();
studentRouter.use(authenticate);

studentRouter.get('/', authorizePermission('imports.view'), validateRequest(listStudentsSchema), studentController.list);
studentRouter.get('/:id', authorizePermission('imports.view'), validateRequest(studentIdSchema), studentController.get);
studentRouter.get('/:id/documents', authorizePermission('imports.view'), validateRequest(studentIdSchema), studentController.documents);
studentRouter.get(
  '/:id/documents/:documentId/file',
  authorizePermission('imports.view'),
  validateRequest(studentDocumentSchema),
  studentController.documentFile,
);
