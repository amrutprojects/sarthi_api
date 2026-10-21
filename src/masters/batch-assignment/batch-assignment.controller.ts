import type { Request, Response } from 'express';
import { body, params, query } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { batchAssignmentService } from './batch-assignment.service';
import type {
  CreateBatchAssignmentBody, ListBatchAssignmentsQuery, StudentOptionsQuery, UpdateBatchAssignmentBody,
} from './batch-assignment.validator';

type IdParams = { id: string };

export const batchAssignmentController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await batchAssignmentService.list(query<ListBatchAssignmentsQuery>(req));
    ApiResponse.ok(res, page.items, 'Batch assignments retrieved successfully', page.meta);
  }),

  studentOptions: asyncHandler(async (req: Request, res: Response) => {
    const { search } = query<StudentOptionsQuery>(req);
    ApiResponse.ok(res, await batchAssignmentService.studentOptions(search), 'Students retrieved successfully');
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await batchAssignmentService.get(params<IdParams>(req).id), 'Batch assignment retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(
      res,
      await batchAssignmentService.create(body<CreateBatchAssignmentBody>(req), req),
      'Student assigned to the batch successfully',
    );
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      await batchAssignmentService.update(params<IdParams>(req).id, body<UpdateBatchAssignmentBody>(req), req),
      'Batch assignment updated successfully',
    );
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    ApiResponse.ok(
      res,
      await batchAssignmentService.setStatus(params<IdParams>(req).id, isActive, req),
      isActive ? 'Batch assignment activated' : 'Batch assignment deactivated',
    );
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await batchAssignmentService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Batch assignment deleted successfully');
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await batchAssignmentService.restore(params<IdParams>(req).id, req), 'Batch assignment restored (inactive)');
  }),
};
