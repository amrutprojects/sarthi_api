import { Router } from 'express';
import { authenticate } from '../../../middleware/authenticate.middleware';
import { authorizePermission } from '../../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../../middleware/validate-request.middleware';
import { studentController } from './student.controller';
import { listStudentsSchema, studentDocumentSchema, studentIdSchema, studentSummarySchema } from './student.validation';

/* Student register (A-18): read-only and masked; students are created only by import finalisation. */
export const studentRouter = Router();
studentRouter.use(authenticate);

/* Masked register views: the import screens (imports.view) and the dashboard's candidate pages (candidates.view). */
const viewRegister = authorizePermission(['imports.view', 'candidates.view'], { any: true });

/* Registered before '/:id' so 'summary' is never read as an id. */
studentRouter.get(
  '/summary',
  authorizePermission(['dashboard.view', 'candidates.view', 'imports.view'], { any: true }),
  validateRequest(studentSummarySchema),
  studentController.summary,
);
studentRouter.get('/', viewRegister, validateRequest(listStudentsSchema), studentController.list);
studentRouter.get('/:id', viewRegister, validateRequest(studentIdSchema), studentController.get);
studentRouter.get('/:id/documents', viewRegister, validateRequest(studentIdSchema), studentController.documents);
/* Opening a file stays with the import screens. */
studentRouter.get(
  '/:id/documents/:documentId/file',
  authorizePermission('imports.view'),
  validateRequest(studentDocumentSchema),
  studentController.documentFile,
);
