import type { Request, Response } from 'express';
import { body, params } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { AppError } from '../../shared/errors/app-error';
import { visibilityService } from './visibility.service';
import type { SectionKeyParams, UpdateVisibilityBody } from './visibility.validator';

export const visibilityController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    /* authenticate() always sets req.auth; the guard only keeps the type honest. */
    if (!req.auth) throw AppError.unauthorized();
    ApiResponse.ok(res, await visibilityService.list(req.auth.permissions), 'Section visibility retrieved successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const { visible } = body<UpdateVisibilityBody>(req);
    const data = await visibilityService.set(params<SectionKeyParams>(req).key, visible, req);
    ApiResponse.ok(res, data, visible ? 'Section shown on the website' : 'Section hidden from the website');
  }),
};
