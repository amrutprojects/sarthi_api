import { Router } from 'express';
import { authenticate } from '../../../middleware/authenticate.middleware';
import { authorizePermission } from '../../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../../middleware/validate-request.middleware';
import { idempotent } from '../../../shared/idempotency/idempotency.middleware';
import { importController as c } from './import.controller';
import { receiveDocumentsZip, receiveImportUpload } from './upload.middleware';
import {
  batchIdSchema,
  decideSchema,
  finaliseSchema,
  listBatchesSchema,
  listRowsSchema,
  reasonSchema,
  restoreRowSchema,
  rowDocumentSchema,
  rowParamsSchema,
} from './import.validation';

/*
 * Approved-student data import (spec A-11..A-17). Permissions follow the "Student Import" menu:
 * imports.view (read) · imports.create (upload) · imports.update (resolve rows, decide matches) ·
 * imports.delete (cancel a batch) · imports.approve (finalise, by a second person).
 */
export const importRouter = Router();
importRouter.use(authenticate);

importRouter.get('/template.csv', authorizePermission('imports.view'), c.template);
importRouter.get('/template.xlsx', authorizePermission('imports.view'), c.templateXlsx);
importRouter.get('/sample-documents.zip', authorizePermission('imports.view'), c.sampleDocuments);
importRouter.get('/reference', authorizePermission('imports.view'), c.reference);
importRouter.get('/', authorizePermission('imports.view'), validateRequest(listBatchesSchema), c.list);
importRouter.post('/', authorizePermission('imports.create'), receiveImportUpload, c.upload);
importRouter.get('/:id', authorizePermission('imports.view'), validateRequest(batchIdSchema), c.get);
importRouter.get('/:id/rows', authorizePermission('imports.view'), validateRequest(listRowsSchema), c.rows);
importRouter.post('/:id/rows/:rowId/accept', authorizePermission('imports.update'), validateRequest(reasonSchema), c.accept);
importRouter.post('/:id/rows/:rowId/reject', authorizePermission('imports.update'), validateRequest(reasonSchema), c.reject);
importRouter.post('/:id/rows/:rowId/restore', authorizePermission('imports.update'), validateRequest(restoreRowSchema), c.restore);
importRouter.post('/:id/rows/:rowId/decide', authorizePermission('imports.update'), validateRequest(decideSchema), c.decide);
importRouter.post('/:id/finalise', authorizePermission('imports.approve'), validateRequest(finaliseSchema), idempotent, c.finalise);
importRouter.post(
  '/:id/documents',
  authorizePermission('imports.update'),
  validateRequest(batchIdSchema),
  receiveDocumentsZip,
  c.uploadDocuments,
);
importRouter.get('/:id/rows/:rowId/documents', authorizePermission('imports.view'), validateRequest(rowParamsSchema), c.rowDocuments);
importRouter.get(
  '/:id/rows/:rowId/documents/:documentId/file',
  authorizePermission('imports.view'),
  validateRequest(rowDocumentSchema),
  c.rowDocumentFile,
);
importRouter.post('/:id/cancel', authorizePermission('imports.delete'), validateRequest(batchIdSchema), c.cancel);
