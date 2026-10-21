import type { NextFunction, Request, Response } from 'express';
import { pipeline } from 'stream';
import { body, params, query } from '../../middleware/validate-request.middleware';
import { AppError } from '../../shared/errors/app-error';
import { ApiResponse } from '../../shared/http/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { attachmentDisposition } from './document.storage';
import { documentService } from './document.service';
import type { CreateDocumentBody, ListDocumentsQuery, UpdateDocumentBody, VerifyDocumentBody } from './document.validator';

type IdParams = { id: string };

export const documentController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await documentService.list(query<ListDocumentsQuery>(req));
    ApiResponse.ok(res, page.items, 'Documents retrieved successfully', page.meta);
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await documentService.get(params<IdParams>(req).id), 'Document retrieved successfully');
  }),

  /* Multipart: the metadata in the text fields, the file in "file" (memory storage, see document.routes.ts). */
  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await documentService.create(body<CreateDocumentBody>(req), req.file, req), 'Document uploaded successfully');
  }),

  /* Multipart or JSON. A new file alone is a valid update, so "nothing to change" is checked here, with the file in view. */
  update: asyncHandler(async (req: Request, res: Response) => {
    const input = body<UpdateDocumentBody>(req);
    if (!req.file && Object.keys(input).length === 0) {
      throw AppError.validation([{ field: 'body', message: 'Provide at least one field to update or a new file' }]);
    }
    ApiResponse.ok(res, await documentService.update(params<IdParams>(req).id, input, req.file, req), 'Document updated successfully');
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    ApiResponse.ok(
      res,
      await documentService.setStatus(params<IdParams>(req).id, isActive, req),
      isActive ? 'Document activated' : 'Document deactivated',
    );
  }),

  verify: asyncHandler(async (req: Request, res: Response) => {
    const input = body<VerifyDocumentBody>(req);
    ApiResponse.ok(
      res,
      await documentService.verify(params<IdParams>(req).id, input, req),
      input.status === 'VERIFIED' ? 'Document verified' : 'Document rejected',
    );
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await documentService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Document deleted successfully');
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await documentService.restore(params<IdParams>(req).id, req), 'Document restored (inactive)');
  }),

  /*
   * Streams the stored file as a download. The type is the one detected at upload; nosniff stops a browser
   * from second-guessing it, and the response is never cached by a shared proxy.
   */
  file: asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const file = await documentService.openFile(params<IdParams>(req).id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('Content-Disposition', attachmentDisposition(file.fileName));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    pipeline(file.handle.createReadStream(), res, (err) => {
      /* After the first byte the status is sent; a client that hung up needs no error response. */
      if (err && !res.headersSent) next(err);
    });
  }),
};
