import type { NextFunction, Request, Response } from 'express';
import { pipeline } from 'stream';
import { body, params, query } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../shared/http/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { lmsBrandingService } from './branding.service';
import type { GetBrandingQuery, UpdateBrandingBody } from './branding.validator';

type EntityParams = { entityId: string };

export const lmsBrandingController = {
  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      await lmsBrandingService.get(params<EntityParams>(req).entityId, query<GetBrandingQuery>(req)),
      'Branding and settings retrieved successfully',
    );
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      await lmsBrandingService.update(params<EntityParams>(req).entityId, body<UpdateBrandingBody>(req), req),
      'Branding and settings updated successfully',
    );
  }),

  /* Multipart: the PNG in "file" (memory storage, see branding.routes.ts). */
  uploadLogo: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsBrandingService.uploadLogo(params<EntityParams>(req).entityId, req.file, req), 'Logo uploaded successfully');
  }),

  removeLogo: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsBrandingService.removeLogo(params<EntityParams>(req).entityId, req), 'Logo removed; the platform default applies');
  }),

  /*
   * Streams the logo (authenticated, lms-branding.view). The type is the one detected at upload and
   * nosniff stops a browser from second-guessing it; the response is private to the caller and is
   * revalidated on each use (L-04 "cache-controlled"), with the file's SHA-256 as its ETag.
   */
  logo: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const file = await lmsBrandingService.openLogo(params<EntityParams>(req).entityId);
    const etag = `"${file.sha256}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers['if-none-match'] === etag) {
      await file.handle.close();
      res.status(304).end();
      return;
    }
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.size));
    pipeline(file.handle.createReadStream(), res, (err) => {
      /* After the first byte the status is sent; a client that hung up needs no error response. */
      if (err && !res.headersSent) next(err);
    });
  }),
};
