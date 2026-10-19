import type { Request, Response } from 'express';
import { body } from '../../../middleware/validate-request.middleware';
import { asyncHandler } from '../../../shared/http/async-handler';
import { ApiResponse } from '../../../utils/api-response';
import { REGISTRATION_MESSAGES, registrationService } from './registration.service';
import type { RegistrationBody } from './registration.validation';

export const registrationController = {
  create: asyncHandler(async (req: Request, res: Response) => {
    const result = await registrationService.register(req, body<RegistrationBody>(req));
    ApiResponse.created(res, result, REGISTRATION_MESSAGES.CREATED);
  }),
};
