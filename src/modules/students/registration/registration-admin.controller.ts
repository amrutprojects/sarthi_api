import type { Request, Response } from 'express';
import { MESSAGES } from '../../../constants/api-response.constants';
import { params, query } from '../../../middleware/validate-request.middleware';
import { asyncHandler } from '../../../shared/http/async-handler';
import { ApiResponse } from '../../../utils/api-response';
import { registrationAdminService } from './registration-admin.service';
import type { ListRegistrationsQuery } from './registration-admin.validation';
import { uploadedFiles } from './registration-upload.middleware';
import { REGISTRATION_MESSAGES } from './registration.service';

export const registrationAdminController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await registrationAdminService.list(query<ListRegistrationsQuery>(req));
    ApiResponse.ok(res, page.items, MESSAGES.retrieved('Registrations'), page.meta);
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await registrationAdminService.get(params<{ id: string }>(req).id), MESSAGES.retrieved('Registration'));
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const result = await registrationAdminService.create(req, (req.body as { data?: unknown })?.data, uploadedFiles(req));
    ApiResponse.created(res, result, REGISTRATION_MESSAGES.CREATED);
  }),
};
