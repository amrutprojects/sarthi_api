import type { Request, Response } from 'express';
import { MESSAGES } from '../../../constants/api-response.constants';
import { params, query } from '../../../middleware/validate-request.middleware';
import { ApiResponse } from '../../../utils/api-response';
import { asyncHandler } from '../../../shared/http/async-handler';
import { buildMeta } from '../../../shared/utils/pagination';
import { documentService } from '../documents/document.service';
import { sendFile } from '../documents/send-file';
import { studentService } from './student.service';
import type { ListStudentsQuery } from './student.validation';

export const studentController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const q = query<ListStudentsQuery>(req);
    const { items, total } = await studentService.list(q);
    ApiResponse.ok(res, items, MESSAGES.retrieved('Students'), buildMeta(q, total));
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await studentService.get(params<{ id: string }>(req).id), MESSAGES.retrieved('Student'));
  }),

  documents: asyncHandler(async (req: Request, res: Response) => {
    const { id } = params<{ id: string }>(req);
    await studentService.get(id); // 404 for an unknown student
    ApiResponse.ok(res, await documentService.listForStudent(id), MESSAGES.retrieved('Student documents'));
  }),

  documentFile: asyncHandler(async (req: Request, res: Response) => {
    const p = params<{ id: string; documentId: string }>(req);
    sendFile(res, await documentService.openForDownload(p.id, p.documentId, req));
  }),
};
