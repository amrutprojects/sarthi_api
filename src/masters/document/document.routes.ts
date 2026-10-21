import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { env } from '../../config/env.config';
import { P } from '../../modules/roles-permissions';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { AppError } from '../../shared/errors/app-error';
import { documentController } from './document.controller';
import { fileError, fileRuleMessage } from './document.storage';
import {
  createDocumentSchema, documentIdSchema, documentStatusSchema, listDocumentsSchema, updateDocumentSchema, verifyDocumentSchema,
} from './document.validator';

/*
 * Multipart parsing for create / update: one file in the "file" field, held in memory (at most
 * DOCUMENT_MAX_FILE_MB) so its content can be checked before anything is written to disk. Runs after the
 * permission check, so a caller without the permission never gets a file buffered. A non-multipart
 * request (a JSON update without a new file) passes straight through.
 *
 * Besides the file the form carries at most six short text fields (title, category, description,
 * districtId, centreId, isActive), so the parser refuses anything larger while reading, before it is held
 * in memory: at most 10 fields of 8 KB each (description, the longest, is 500 characters), 11 parts in all,
 * and flat field names of at most 50 bytes. multer needs whole numbers, hence the floor on the size.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Math.floor(env.DOCUMENT_MAX_FILE_MB * 1024 * 1024),
    files: 1,
    fields: 10,
    fieldSize: 8 * 1024,
    parts: 11,
    fieldNameSize: 50,
    fieldNestingDepth: 0,
  },
});
const receiveFile = (req: Request, res: Response, next: NextFunction) =>
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') next(fileError(fileRuleMessage()));
      else if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') next(fileError('Attach a single file in the "file" field'));
      /* Any other multer limit (field count, field size, …) is a malformed request, not a server fault. */
      else next(AppError.badRequest(err.message));
      return;
    }
    /*
     * Anything else the parser raises (a missing or bad boundary, a malformed part header, a body that ends
     * before its closing boundary, a client that hung up) is a malformed request too: with memory storage
     * there is no disk write that could fail on the server's side.
     */
    next(err instanceof AppError ? err : AppError.badRequest('Malformed multipart request'));
  });

/* /api/v1/cms/documents — Document Master. See state.routes.ts for the shared conventions. */
export const documentRouter = Router();

documentRouter.get('/', authorizePermission(P.CMS_DOCUMENTS_VIEW), validateRequest(listDocumentsSchema), documentController.list);
documentRouter.post('/', authorizePermission(P.CMS_DOCUMENTS_CREATE), receiveFile, validateRequest(createDocumentSchema), documentController.create);
documentRouter.get('/:id', authorizePermission(P.CMS_DOCUMENTS_VIEW), validateRequest(documentIdSchema), documentController.get);
/* The private file itself, streamed as a download. Same permission as reading the record. */
documentRouter.get('/:id/file', authorizePermission(P.CMS_DOCUMENTS_VIEW), validateRequest(documentIdSchema), documentController.file);
documentRouter.put('/:id', authorizePermission(P.CMS_DOCUMENTS_UPDATE), receiveFile, validateRequest(updateDocumentSchema), documentController.update);
documentRouter.patch('/:id', authorizePermission(P.CMS_DOCUMENTS_UPDATE), receiveFile, validateRequest(updateDocumentSchema), documentController.update);
documentRouter.patch('/:id/status', authorizePermission(P.CMS_DOCUMENTS_UPDATE), validateRequest(documentStatusSchema), documentController.setStatus);
/* Verify / reject: a separate permission, and never by the uploader (enforced in the service). */
documentRouter.patch(
  '/:id/verification',
  authorizePermission(P.CMS_DOCUMENTS_APPROVE),
  validateRequest(verifyDocumentSchema),
  documentController.verify,
);
documentRouter.delete('/:id', authorizePermission(P.CMS_DOCUMENTS_DELETE), validateRequest(documentIdSchema), documentController.remove);
documentRouter.post('/:id/restore', authorizePermission(P.CMS_DOCUMENTS_DELETE), validateRequest(documentIdSchema), documentController.restore);
