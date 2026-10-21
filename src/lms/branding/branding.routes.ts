import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { env } from '../../config/env.config';
import { P } from '../../modules/roles-permissions';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { AppError } from '../../shared/errors/app-error';
import { lmsBrandingController } from './branding.controller';
import { brandingEntitySchema, getBrandingSchema, updateBrandingSchema } from './branding.validator';

/*
 * Logo upload: the Document Master's multipart handling (document.routes.ts) — one file in "file", held in
 * memory (at most DOCUMENT_MAX_FILE_MB) so its content is checked before anything is written. The form
 * carries nothing else, so no text field is accepted. Runs after the permission check.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.floor(env.DOCUMENT_MAX_FILE_MB * 1024 * 1024), files: 1, fields: 0, parts: 1, fieldNameSize: 50, fieldNestingDepth: 0 },
});
const logoRule = () => `Upload a PNG image within the size limit (at most ${env.DOCUMENT_MAX_FILE_MB} MB).`;
const receiveLogo = (req: Request, res: Response, next: NextFunction) =>
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    const fileErr = (message: string) => AppError.badRequest(message, [{ field: 'file', message }]);
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') next(fileErr(logoRule()));
      else if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') next(fileErr('Attach a single file in the "file" field.'));
      else next(AppError.badRequest(err.message));
      return;
    }
    next(err instanceof AppError ? err : AppError.badRequest('Malformed multipart request'));
  });

/*
 * /api/v1/lms/branding/:entityId — Branding and Settings (AMRUT_KALASH_03 L-04 / FR-304, F-LMS-04, UI-312;
 * API-202 /entities/{id}/branding · /settings). Configuration, not a catalogue: view and update only.
 * Spec permission → code: entity.view → lms-branding.view · entity.branding.update → lms-branding.update
 * (display name, logo, colours) · entity.update → lms-branding.update-settings (support contacts, languages).
 * PUT / PATCH admit either code; the service refuses a key the caller's code does not cover (403).
 * The entity picker is GET /lms/entities/options and the platform language list
 * GET /lms/entities/form-options (both open to lms-branding.view).
 */
export const lmsBrandingRouter = Router();

const UPDATE_ANY = authorizePermission([P.LMS_BRANDING_UPDATE, P.LMS_BRANDING_UPDATE_SETTINGS], { any: true });

lmsBrandingRouter.get('/:entityId', authorizePermission(P.LMS_BRANDING_VIEW), validateRequest(getBrandingSchema), lmsBrandingController.get);
lmsBrandingRouter.put('/:entityId', UPDATE_ANY, validateRequest(updateBrandingSchema), lmsBrandingController.update);
lmsBrandingRouter.patch('/:entityId', UPDATE_ANY, validateRequest(updateBrandingSchema), lmsBrandingController.update);
/* F-LMS-04-02: the logo file, streamed to authenticated viewers only. */
lmsBrandingRouter.get('/:entityId/logo', authorizePermission(P.LMS_BRANDING_VIEW), validateRequest(brandingEntitySchema), lmsBrandingController.logo);
lmsBrandingRouter.put(
  '/:entityId/logo',
  authorizePermission(P.LMS_BRANDING_UPDATE),
  receiveLogo,
  validateRequest(brandingEntitySchema),
  lmsBrandingController.uploadLogo,
);
lmsBrandingRouter.delete(
  '/:entityId/logo',
  authorizePermission(P.LMS_BRANDING_UPDATE),
  validateRequest(brandingEntitySchema),
  lmsBrandingController.removeLogo,
);
