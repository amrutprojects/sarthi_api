import type { Request, Response } from 'express';
import { body } from '../../../middleware/validate-request.middleware';
import { asyncHandler } from '../../../shared/http/async-handler';
import { ApiResponse } from '../../../utils/api-response';
import { REGISTRATION_MESSAGES, registrationService } from './registration.service';
import type { RegistrationBody } from './registration.validation';

export const registrationController = {
  create: asyncHandler(async (req: Request, res: Response) => {
    const { registration_id, registration_number, status } = await registrationService.register(req, body<RegistrationBody>(req));
    ApiResponse.created(res, { registration_id, registration_number, status }, REGISTRATION_MESSAGES.CREATED);
  }),
};
