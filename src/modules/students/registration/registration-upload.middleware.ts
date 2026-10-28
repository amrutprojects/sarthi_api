import fs from 'fs';
import os from 'os';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { AppError } from '../../../shared/errors/app-error';
import { DOCUMENT_FILE_MAX_MB, documentFileRule, UPLOAD_FILE_MAX_MB } from '../documents/file-type';

const MB = 1024 * 1024;
/* A document file's limit; a video type (Applicant Video with Aadhaar) allows up to UPLOAD_FILE_MAX_MB. */
export const REGISTRATION_FILE_MAX_MB = DOCUMENT_FILE_MAX_MB;
const tmpDir = path.join(os.tmpdir(), 'amrut-uploads');
fs.mkdirSync(tmpDir, { recursive: true });

/*
 * Registration upload (admin form and EDP portal): one "data" text field plus up to 20 document files in fields named
 * after the document type code. The multipart limit is the largest any type allows (a 50 MB video); each type's own
 * limit (5 MB for documents) is checked by prepareFiles. Files go to temporary files deleted when the response ends.
 */
const upload = multer({
  storage: multer.diskStorage({ destination: tmpDir }),
  limits: { fileSize: UPLOAD_FILE_MAX_MB * MB, files: 20, fields: 2, fieldSize: 64 * 1024 },
}).any();

export function receiveRegistrationUpload(req: Request, res: Response, next: NextFunction) {
  upload(req, res, (err: unknown) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    res.on('close', () => files.forEach((f) => fs.rm(f.path, { force: true }, () => undefined)));
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE')
        return next(AppError.validation([{ field: `files.${err.field}`, message: `File is larger than ${documentFileRule(err.field ?? '').maxMb} MB` }]));
      return next(AppError.badRequest(err.message));
    }
    if (err) return next(err as Error);
    next();
  });
}

export const uploadedFiles = (req: Request) => (req.files as Express.Multer.File[] | undefined) ?? [];
