import type { Request, Response } from 'express';
import { body, params, query } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../shared/http/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { lmsFormFieldService } from './form-field.service';
import type { CreateLmsFormFieldBody, ListLmsFormFieldsQuery, UpdateLmsFormFieldBody } from './form-field.validator';

type IdParams = { id: string };
type FormParams = { formCode: string };

export const lmsFormFieldController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await lmsFormFieldService.list(query<ListLmsFormFieldsQuery>(req));
    ApiResponse.ok(res, page.items, 'Form fields retrieved successfully', page.meta);
  }),

  formOptions: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, lmsFormFieldService.formOptions(), 'Form field options retrieved successfully');
  }),

  effective: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsFormFieldService.effective(params<FormParams>(req).formCode), 'Form configuration retrieved successfully');
  }),

  sections: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsFormFieldService.sections(params<FormParams>(req).formCode), 'Form sections retrieved successfully');
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsFormFieldService.get(params<IdParams>(req).id), 'Form field retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await lmsFormFieldService.create(body<CreateLmsFormFieldBody>(req), req), 'Custom field added successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      await lmsFormFieldService.update(params<IdParams>(req).id, body<UpdateLmsFormFieldBody>(req), req),
      'Form field updated successfully',
    );
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    ApiResponse.ok(res, await lmsFormFieldService.setStatus(params<IdParams>(req).id, isActive, req), isActive ? 'Form field activated' : 'Custom field archived');
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await lmsFormFieldService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Custom field deleted successfully');
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await lmsFormFieldService.restore(params<IdParams>(req).id, req), 'Custom field restored (archived)');
  }),
};
