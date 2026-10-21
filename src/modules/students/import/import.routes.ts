import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { env } from '../../../config/env.config';
import { authenticate } from '../../../middleware/authenticate.middleware';
import { authorizePermission } from '../../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../../middleware/validate-request.middleware';
import { AppError } from '../../../shared/errors/app-error';
import { idempotent } from '../../../shared/idempotency/idempotency.middleware';
import { importController as c } from './import.controller';
import {
  batchIdSchema,
  decideSchema,
  finaliseSchema,
  listBatchesSchema,
  listRowsSchema,
  reasonSchema,
  restoreRowSchema,
} from './import.validation';

/*
 * Approved-student data import (spec A-11..A-17). Permissions follow the "Student Import" menu:
 * imports.view (read) · imports.create (upload) · imports.update (resolve rows, decide matches) ·
 * imports.delete (cancel a batch) · imports.approve (finalise, by a second person).
 */
/* multer 2 refuses (at startup) a limit that is not a whole number, and IMPORT_MAX_FILE_MB may be fractional. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.floor(env.IMPORT_MAX_FILE_MB * 1024 * 1024), files: 1 },
});
const receiveFile = (req: Request, res: Response, next: NextFunction) =>
  upload.single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      next(AppError.badRequest(err.code === 'LIMIT_FILE_SIZE' ? `The file is larger than ${env.IMPORT_MAX_FILE_MB} MB` : err.message));
      return;
    }
    next(err as Error | undefined);
  });

export const importRouter = Router();
importRouter.use(authenticate);

importRouter.get('/template.csv', authorizePermission('imports.view'), c.template);
importRouter.get('/reference', authorizePermission('imports.view'), c.reference);
importRouter.get('/', authorizePermission('imports.view'), validateRequest(listBatchesSchema), c.list);
importRouter.post('/', authorizePermission('imports.create'), receiveFile, c.upload);
importRouter.get('/:id', authorizePermission('imports.view'), validateRequest(batchIdSchema), c.get);
importRouter.get('/:id/rows', authorizePermission('imports.view'), validateRequest(listRowsSchema), c.rows);
importRouter.post('/:id/rows/:rowId/accept', authorizePermission('imports.update'), validateRequest(reasonSchema), c.accept);
importRouter.post('/:id/rows/:rowId/reject', authorizePermission('imports.update'), validateRequest(reasonSchema), c.reject);
importRouter.post('/:id/rows/:rowId/restore', authorizePermission('imports.update'), validateRequest(restoreRowSchema), c.restore);
importRouter.post('/:id/rows/:rowId/decide', authorizePermission('imports.update'), validateRequest(decideSchema), c.decide);
importRouter.post('/:id/finalise', authorizePermission('imports.approve'), validateRequest(finaliseSchema), idempotent, c.finalise);
importRouter.post('/:id/cancel', authorizePermission('imports.delete'), validateRequest(batchIdSchema), c.cancel);
