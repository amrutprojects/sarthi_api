import { randomUUID } from 'crypto';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { logger } from '../../observability/logger';
import { AppError } from '../../shared/errors/app-error';
/*
 * The project's one file store: STORAGE_DIR on disk, or the private S3 bucket when STORAGE_DRIVER=s3.
 * Member photos live beside the student documents under their own 'cms/board-members/' prefix and,
 * like them, are never served statically — only through the photo routes below.
 */
import { documentStorage } from '../../modules/students/documents/document-storage';
import type { PhotoUpload } from './board.types';

export const PHOTO_MAX_MB = 5;
const MB = 1024 * 1024;
const PREFIX = 'cms/board-members';

const MIME: Record<PhotoUpload['ext'], string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/*
 * The image type, read from the file's first bytes. The name and the browser-sent Content-Type are
 * both under the uploader's control; the bytes are what a browser will actually decode.
 */
export function detectImage(buf: Buffer): PhotoUpload['ext'] | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/* The extensions a file of each type may carry; a renamed file is refused, as for student documents. */
const EXTENSIONS: Record<PhotoUpload['ext'], string[]> = { jpg: ['.jpg', '.jpeg'], png: ['.png'], webp: ['.webp'] };

const invalid = (message: string) => AppError.validation([{ field: 'photo', message }]);

/* Checks an uploaded file and returns what will be stored, or undefined when no photo was sent. */
export function inspectPhoto(file: Express.Multer.File | undefined): PhotoUpload | undefined {
  if (!file) return undefined;
  if (!file.size) throw invalid('The photo file is empty');
  const ext = detectImage(file.buffer);
  if (!ext) throw invalid('The photo must be a JPEG, PNG or WebP image');
  if (!EXTENSIONS[ext].includes(path.extname(file.originalname).toLowerCase())) {
    throw invalid(`The file name does not match its content: this is a ${ext.toUpperCase()} image, so name it ${EXTENSIONS[ext].join(' or ')}`);
  }
  return { buffer: file.buffer, ext };
}

/*
 * multipart/form-data for create and update: an optional `photo` file (≤ 5 MB, kept in memory — it is
 * small and is checked before anything is written) and a `data` field holding the same JSON a plain
 * JSON request would send. `data` is unpacked into req.body so the route's validateRequest() sees one
 * shape either way. A JSON request passes through untouched.
 *
 * A factory because the sections that share it carry different amounts of text: `fieldSize` caps the
 * `data` field in bytes, and `tooLong`, when given, turns an over-long `data` into a 422 the admin can
 * act on (otherwise it is multer's generic 400).
 */
export function makeReceivePhoto(opts: { fieldSize: number; tooLong?: string }) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: PHOTO_MAX_MB * MB, files: 1, fields: 1, fieldSize: opts.fieldSize },
  }).single('photo');

  return function receivePhoto(req: Request, res: Response, next: NextFunction) {
    if (!req.is('multipart/form-data')) return next();
    upload(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return next(invalid(`The photo is larger than ${PHOTO_MAX_MB} MB`));
        if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT')
          return next(invalid('Send at most one photo, in the "photo" field'));
        if (err.code === 'LIMIT_FIELD_COUNT')
          return next(AppError.validation([{ field: 'body.data', message: 'Send the member as one "data" field' }]));
        if (err.code === 'LIMIT_FIELD_VALUE' && opts.tooLong)
          return next(AppError.validation([{ field: 'body.data', message: opts.tooLong }]));
        return next(AppError.badRequest(`Invalid upload: ${err.message}`));
      }
      if (err) return next(err as Error);

      const raw = (req.body as { data?: unknown } | undefined)?.data;
      if (raw === undefined) {
        req.body = {};
        return next();
      }
      try {
        req.body = JSON.parse(String(raw)) as unknown;
      } catch {
        return next(AppError.validation([{ field: 'body.data', message: 'data must be valid JSON' }]));
      }
      next();
    });
  };
}

/* Board Members: a name and a few short lines, so 64 KiB of JSON is ample. */
export const receivePhoto = makeReceivePhoto({ fieldSize: 64 * 1024 });

export const uploadedPhoto = (req: Request) => req.file;

export const photoStore = {
  /* A fresh key per upload: a replaced photo never reuses its predecessor's URL. */
  newKey: (ext: PhotoUpload['ext']) => `${PREFIX}/${randomUUID()}.${ext}`,
  keyOf: (file: string) => `${PREFIX}/${file}`,
  fileOf: (key: string) => key.slice(PREFIX.length + 1),

  write: (key: string, photo: PhotoUpload) => documentStorage.write(key, photo.buffer),

  /*
   * Best-effort removal of a file the database no longer references. Only ever called AFTER the
   * change that dropped the reference has committed, so a failed save can never lose a live photo;
   * a failure here leaves an unreferenced file behind, which is harmless, and is logged.
   */
  async discard(key: string | null | undefined, reason: string): Promise<void> {
    if (!key) return;
    try {
      await documentStorage.remove(key);
    } catch (err) {
      logger.warn({ err, key, reason }, 'board member photo could not be removed from storage');
    }
  },

  /*
   * Streams a stored photo inline. The key is immutable (new upload, new key), so it may be cached;
   * `corp` decides who may embed it: 'cross-origin' for the public site, 'same-site' for the admin.
   */
  async send(res: Response, key: string, opts: { cache: string; corp: 'cross-origin' | 'same-site' }): Promise<void> {
    if (!(await documentStorage.exists(key))) {
      logger.warn({ key }, 'board member photo is referenced but missing from storage');
      throw AppError.notFound('Photo not found');
    }
    const stream = await documentStorage.read(key);
    const ext = path.extname(key).slice(1) as PhotoUpload['ext'];
    res.setHeader('Content-Type', MIME[ext]);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', opts.cache);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', opts.corp);
    stream.on('error', (err) => {
      logger.warn({ err, key }, 'board member photo stream failed');
      res.destroy();
    });
    stream.pipe(res);
  },
};
