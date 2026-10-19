import fs from 'fs';
import os from 'os';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { env } from '../../../config/env.config';
import { AppError } from '../../../shared/errors/app-error';

const MB = 1024 * 1024;
const tmpDir = path.join(os.tmpdir(), 'amrut-uploads');
fs.mkdirSync(tmpDir, { recursive: true });

/*
 * Uploads go to temporary files (never fully into memory) and are always deleted when the response ends.
 * Field "file": the student data (CSV/XLSX, ≤ IMPORT_MAX_FILE_MB). Field "documents": a ZIP of documents
 * (≤ DOCUMENTS_ZIP_MAX_MB). Names are random; the original name is only kept as metadata.
 */
const upload = multer({
  storage: multer.diskStorage({ destination: tmpDir }),
  limits: { fileSize: Math.max(env.IMPORT_MAX_FILE_MB, env.DOCUMENTS_ZIP_MAX_MB) * MB, files: 2, fields: 10 },
});

export type UploadedFile = Express.Multer.File;

const cleanupAfterResponse = (req: Request, res: Response) => {
  const files = Object.values((req.files as Record<string, UploadedFile[]> | undefined) ?? {}).flat();
  if (req.file) files.push(req.file);
  res.on('close', () => files.forEach((f) => fs.rm(f.path, { force: true }, () => undefined)));
};

const handle = (mw: ReturnType<typeof upload.fields>) => (req: Request, res: Response, next: NextFunction) =>
  mw(req, res, (err: unknown) => {
    cleanupAfterResponse(req, res);
    if (err instanceof multer.MulterError) {
      next(AppError.badRequest(err.code === 'LIMIT_FILE_SIZE' ? `A file is larger than ${env.DOCUMENTS_ZIP_MAX_MB} MB` : err.message));
      return;
    }
    if (err) return next(err as Error);
    const files = (req.files as Record<string, UploadedFile[]> | undefined) ?? {};
    const data = files.file?.[0];
    const zip = files.documents?.[0];
    if (data && data.size > env.IMPORT_MAX_FILE_MB * MB)
      return next(AppError.badRequest(`The data file is larger than ${env.IMPORT_MAX_FILE_MB} MB`));
    if (zip && zip.size > env.DOCUMENTS_ZIP_MAX_MB * MB)
      return next(AppError.badRequest(`The documents ZIP is larger than ${env.DOCUMENTS_ZIP_MAX_MB} MB`));
    next();
  });

/* POST /imports: "file" (required) and "documents" (optional). */
export const receiveImportUpload = handle(
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'documents', maxCount: 1 },
  ]),
);

/* POST /imports/:id/documents: "documents" (required). */
export const receiveDocumentsZip = handle(upload.fields([{ name: 'documents', maxCount: 1 }]));

export const uploadedFile = (req: Request, field: 'file' | 'documents'): UploadedFile | undefined =>
  (req.files as Record<string, UploadedFile[]> | undefined)?.[field]?.[0];
