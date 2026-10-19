import type { Request, Response } from 'express';
import { params, query } from '../../../middleware/validate-request.middleware';
import { ApiResponse } from '../../../shared/http/api-response';
import { asyncHandler } from '../../../shared/http/async-handler';
import { buildMeta } from '../../../shared/utils/pagination';
import { studentService } from './student.service';
import type { ListStudentsQuery } from './student.validation';

export const studentController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const q = query<ListStudentsQuery>(req);
    const { items, total } = await studentService.list(q);
    ApiResponse.ok(res, items, 'Students', buildMeta(q, total));
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await studentService.get(params<{ id: string }>(req).id), 'Student');
  }),
};
