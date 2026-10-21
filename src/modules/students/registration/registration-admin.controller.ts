import type { Request, Response } from 'express';
import { MESSAGES } from '../../../constants/api-response.constants';
import { body, params, query } from '../../../middleware/validate-request.middleware';
import { asyncHandler } from '../../../shared/http/async-handler';
import { ApiResponse } from '../../../utils/api-response';
import { registrationAdminService } from './registration-admin.service';
import type { EditRegistrationBody, ListRegistrationsQuery } from './registration-admin.validation';
import { uploadedFiles } from './registration-upload.middleware';
import { REGISTRATION_MESSAGES } from './registration.service';
import { documentService } from '../documents/document.service';
import { sendFile } from '../documents/send-file';

export const registrationAdminController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const unmask = req.auth!.permissions.has('registrations.update');
    const page = await registrationAdminService.list(query<ListRegistrationsQuery>(req), { unmask, req });
    ApiResponse.ok(res, page.items, MESSAGES.retrieved('Registrations'), page.meta);
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    /* Full email / mobile / Aadhaar only for reviewers (registrations.update); each such view is audited. */
    const unmask = req.auth!.permissions.has('registrations.update');
    ApiResponse.ok(
      res,
      await registrationAdminService.get(params<{ id: string }>(req).id, { unmask, req }),
      MESSAGES.retrieved('Registration'),
    );
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

  update: asyncHandler(async (req: Request, res: Response) => {
    const dto = await registrationAdminService.update(req, params<{ id: string }>(req).id, body<EditRegistrationBody>(req));
    ApiResponse.ok(res, dto, MESSAGES.updated('Student'));
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    const dto = await registrationAdminService.setStatus(req, params<{ id: string }>(req).id, isActive);
    ApiResponse.ok(res, dto, isActive ? MESSAGES.activated('Student') : MESSAGES.deactivated('Student'));
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await registrationAdminService.remove(req, params<{ id: string }>(req).id);
    ApiResponse.ok(res, null, MESSAGES.deleted('Student'));
  }),

  replaceDocuments: asyncHandler(async (req: Request, res: Response) => {
    const dto = await registrationAdminService.replaceDocuments(
      req,
      params<{ id: string }>(req).id,
      (req.body as { data?: unknown })?.data,
      uploadedFiles(req),
    );
    ApiResponse.ok(res, dto, MESSAGES.updated('Documents'));
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const result = await registrationAdminService.create(req, (req.body as { data?: unknown })?.data, uploadedFiles(req));
    ApiResponse.created(res, result, REGISTRATION_MESSAGES.CREATED);
  }),
};
