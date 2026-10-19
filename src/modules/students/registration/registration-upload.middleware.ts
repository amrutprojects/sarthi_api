import fs from 'fs';
import os from 'os';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { AppError } from '../../../shared/errors/app-error';

const MB = 1024 * 1024;
export const REGISTRATION_FILE_MAX_MB = 5;
const tmpDir = path.join(os.tmpdir(), 'amrut-uploads');
fs.mkdirSync(tmpDir, { recursive: true });

/*
 * Admin registration upload: one "data" text field plus up to 20 document files (≤ 5 MB each) in fields named after
 * the document type code. Files go to temporary files that are deleted when the response ends.
 */
const upload = multer({
  storage: multer.diskStorage({ destination: tmpDir }),
  limits: { fileSize: REGISTRATION_FILE_MAX_MB * MB, files: 20, fields: 2, fieldSize: 64 * 1024 },
}).any();

export function receiveRegistrationUpload(req: Request, res: Response, next: NextFunction) {
  upload(req, res, (err: unknown) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    res.on('close', () => files.forEach((f) => fs.rm(f.path, { force: true }, () => undefined)));
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE')
        return next(AppError.validation([{ field: `files.${err.field}`, message: `File is larger than ${REGISTRATION_FILE_MAX_MB} MB` }]));
      return next(AppError.badRequest(err.message));
    }
    if (err) return next(err as Error);
    next();
  });
}

export const uploadedFiles = (req: Request) => (req.files as Express.Multer.File[] | undefined) ?? [];
