import type { Request, Response } from 'express';
import { MESSAGES } from '../../../constants/api-response.constants';
import { params, query } from '../../../middleware/validate-request.middleware';
import { asyncHandler } from '../../../shared/http/async-handler';
import { ApiResponse } from '../../../utils/api-response';
import { registrationAdminService } from './registration-admin.service';
import type { ListRegistrationsQuery } from './registration-admin.validation';
import { uploadedFiles } from './registration-upload.middleware';
import { REGISTRATION_MESSAGES } from './registration.service';
import { documentService } from '../documents/document.service';
import { sendFile } from '../documents/send-file';

export const registrationAdminController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await registrationAdminService.list(query<ListRegistrationsQuery>(req));
    ApiResponse.ok(res, page.items, MESSAGES.retrieved('Registrations'), page.meta);
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await registrationAdminService.get(params<{ id: string }>(req).id), MESSAGES.retrieved('Registration'));
  }),

  /* One uploaded file (audited download); the admin panel previews it. */
  documentFile: asyncHandler(async (req: Request, res: Response) => {
    const p = params<{ id: string; documentId: string }>(req);
    await registrationAdminService.get(p.id);
    sendFile(res, await documentService.openForDownload(p.id, p.documentId, req));
  }),

  verifyDocument: asyncHandler(async (req: Request, res: Response) => {
    const p = params<{ id: string; documentId: string }>(req);
    ApiResponse.ok(res, await registrationAdminService.verifyDocument(req, p.id, p.documentId), 'Document verified');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const result = await registrationAdminService.create(req, (req.body as { data?: unknown })?.data, uploadedFiles(req));
    ApiResponse.created(res, result, REGISTRATION_MESSAGES.CREATED);
  }),
};
