import { randomUUID } from 'crypto';
import path from 'path';
import type { Response } from 'express';
import { logger } from '../../observability/logger';
import { AppError } from '../../shared/errors/app-error';
/*
 * The project's one file store: STORAGE_DIR on disk, or the private S3 bucket when STORAGE_DRIVER=s3.
 * Member photos live beside the student documents under their own 'cms/advisory-committee/' prefix
 * and, like them, are never served statically — only through the photo routes.
 */
import { documentStorage } from '../../modules/students/documents/document-storage';
import type { PhotoUpload } from './advisory.types';

import { makeReceivePhoto } from '../board/board.photo';

/*
 * The upload itself — multipart parsing, the 5 MB limit and the content/extension check — is exactly
 * Board Members' (board.photo.ts), so it is reused rather than copied: a fix to the image check then
 * reaches both sections. Only where the files are kept differs, which is the store below.
 */
export { inspectPhoto, uploadedPhoto } from '../board/board.photo';

/*
 * The `data` field, however, is far larger than a board member's: a full profile (five lists of 30
 * items of 400 characters in both languages, plus the experience) is about 240 KB of UTF-8 when it is
 * all Devanagari (3 bytes a character). 512 KiB leaves room for JSON overhead; the JSON parser for
 * this section is given the same limit in app.ts.
 */
export const DATA_FIELD_MAX_BYTES = 512 * 1024;
export const receivePhoto = makeReceivePhoto({
  fieldSize: DATA_FIELD_MAX_BYTES,
  tooLong: 'The profile is too long to save in one request; shorten the lists',
});

const PREFIX = 'cms/advisory-committee';

const MIME: Record<PhotoUpload['ext'], string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

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
      logger.warn({ err, key, reason }, 'advisory member photo could not be removed from storage');
    }
  },

  /*
   * Streams a stored photo inline. The key is immutable (new upload, new key), so it may be cached;
   * `corp` decides who may embed it: 'cross-origin' for the public site, 'same-site' for the admin.
   */
  async send(res: Response, key: string, opts: { cache: string; corp: 'cross-origin' | 'same-site' }): Promise<void> {
    if (!(await documentStorage.exists(key))) {
      logger.warn({ key }, 'advisory member photo is referenced but missing from storage');
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
      logger.warn({ err, key }, 'advisory member photo stream failed');
      res.destroy();
    });
    stream.pipe(res);
  },
};
