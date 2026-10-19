import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { env } from '../config/env.config';
import { BATCH_STATUS, ROW_STATUS } from '../constants/student.constants';
import { authenticate } from '../middleware/authenticate.middleware';
import { authorizePermission } from '../middleware/authorize-permission.middleware';
import { body, params, query, validateRequest } from '../middleware/validate-request.middleware';
import { importService, type MatchDecision } from '../services/import/import.service';
import { studentService } from '../services/import/student.service';
import { ApiResponse } from '../utils/api-response';
import { AppError } from '../utils/app-error';
import { asyncHandler } from '../utils/async-handler';
import { buildMeta } from '../utils/pagination';
import { uuid } from '../validators/common.validator';

/*
 * Approved-student data import (spec A-11..A-18). Permissions follow the "Student Import" menu:
 * imports.view (read batches, rows, register) · imports.create (upload) · imports.update (resolve rows,
 * decide matches) · imports.delete (cancel a batch) · imports.approve (finalise, by a second person).
 */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.IMPORT_MAX_FILE_MB * 1024 * 1024, files: 1 } });
const receiveFile = (req: Request, res: Response, next: NextFunction) =>
  upload.single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      return next(AppError.badRequest(err.code === 'LIMIT_FILE_SIZE' ? `The file is larger than ${env.IMPORT_MAX_FILE_MB} MB` : err.message));
    }
    return next(err as Error | undefined);
  });

const page = { page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(200).default(25) };
const search = z.string().trim().max(100).optional();
const reason = z.string().trim().min(3, 'Give a reason (at least 3 characters)').max(500);
const batchParams = z.object({ id: uuid });
const rowParams = z.object({ id: uuid, rowId: uuid });

export const importRouter = Router();
importRouter.use(authenticate);

importRouter.get('/template.csv', authorizePermission('imports.view'), (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="student-import-template.csv"');
  res.send(studentService.template());
});

importRouter.get('/reference', authorizePermission('imports.view'), (_req, res) => {
  ApiResponse.ok(res, { ...studentService.reference(), maxFileMb: env.IMPORT_MAX_FILE_MB, maxRows: env.IMPORT_MAX_ROWS }, 'Import reference');
});

importRouter.get('/', authorizePermission('imports.view'),
  validateRequest({ query: z.object({ ...page, search, status: z.nativeEnum(BATCH_STATUS).optional() }) }),
  asyncHandler(async (req, res) => {
    const q = query<{ page: number; limit: number; search?: string; status?: string }>(req);
    const { items, total } = await importService.listBatches(q);
    ApiResponse.ok(res, items, 'Import batches', buildMeta(q, total));
  }));

importRouter.post('/', authorizePermission('imports.create'), receiveFile, asyncHandler(async (req, res) => {
  if (!req.file) throw AppError.badRequest('Attach a CSV or XLSX file in the "file" field');
  const sourceReference = typeof req.body?.sourceReference === 'string' ? req.body.sourceReference.trim().slice(0, 120) || null : null;
  const { batch, duplicate } = await importService.createFromFile(req.file, sourceReference, req.auth!, req);
  if (duplicate) return ApiResponse.ok(res, batch, `This file was already uploaded as ${batch.code}; the existing batch is shown`);
  return ApiResponse.created(res, batch, batch.status === BATCH_STATUS.IMPORT_FAILED ? `Import failed: ${batch.failureReason}` : 'File received and validated');
}));

importRouter.get('/:id', authorizePermission('imports.view'), validateRequest({ params: batchParams }), asyncHandler(async (req, res) => {
  ApiResponse.ok(res, await importService.getBatch(params<{ id: string }>(req).id), 'Import batch');
}));

importRouter.get('/:id/rows', authorizePermission('imports.view'),
  validateRequest({ params: batchParams, query: z.object({ ...page, search, status: z.nativeEnum(ROW_STATUS).optional(), issue: z.string().max(40).optional() }) }),
  asyncHandler(async (req, res) => {
    const q = query<{ page: number; limit: number; search?: string; status?: string; issue?: string }>(req);
    const { items, total } = await importService.listRows(params<{ id: string }>(req).id, q);
    ApiResponse.ok(res, items, 'Import rows', buildMeta(q, total));
  }));

const rowAction = (path: string, schema: z.ZodTypeAny, run: (req: Request, p: { id: string; rowId: string }) => Promise<unknown>, message: string) =>
  importRouter.post(path, authorizePermission('imports.update'), validateRequest({ params: rowParams, body: schema }),
    asyncHandler(async (req, res) => { ApiResponse.ok(res, await run(req, params(req)), message); }));

rowAction('/:id/rows/:rowId/accept', z.object({ reason }).strict(),
  (req, p) => importService.acceptIssues(p.id, p.rowId, body<{ reason: string }>(req).reason, req.auth!, req), 'Issues accepted with reason');
rowAction('/:id/rows/:rowId/reject', z.object({ reason }).strict(),
  (req, p) => importService.rejectRow(p.id, p.rowId, body<{ reason: string }>(req).reason, req), 'Row rejected');
rowAction('/:id/rows/:rowId/restore', z.object({}).strict(),
  (req, p) => importService.restoreRow(p.id, p.rowId, req), 'Row restored');
rowAction('/:id/rows/:rowId/decide', z.object({ decision: z.enum(['SAME_PERSON', 'DIFFERENT_PERSON', 'HOLD']), reason }).strict(),
  (req, p) => {
    const b = body<{ decision: MatchDecision; reason: string }>(req);
    return importService.decide(p.id, p.rowId, b.decision, b.reason, req.auth!, req);
  }, 'Decision recorded');

importRouter.post('/:id/finalise', authorizePermission('imports.approve'),
  validateRequest({ params: batchParams, body: z.object({ confirmCode: z.string().trim().min(1).max(20) }).strict() }),
  asyncHandler(async (req, res) => {
    const batch = await importService.finalise(params<{ id: string }>(req).id, body<{ confirmCode: string }>(req).confirmCode, req.auth!, req);
    ApiResponse.ok(res, batch, `Batch finalised: ${batch.counts.created ?? 0} students created, ${batch.counts.linked ?? 0} linked`);
  }));

importRouter.post('/:id/cancel', authorizePermission('imports.delete'), validateRequest({ params: batchParams }), asyncHandler(async (req, res) => {
  ApiResponse.ok(res, await importService.cancel(params<{ id: string }>(req).id, req.auth!, req), 'Batch cancelled');
}));

/* Student register (A-18): read-only, masked; students are created only by finalisation. */
export const studentRouter = Router();
studentRouter.use(authenticate);

studentRouter.get('/', authorizePermission('imports.view'),
  validateRequest({ query: z.object({ ...page, search, centre: z.string().max(10).optional(), track: z.string().max(4).optional(), batch: uuid.optional() }) }),
  asyncHandler(async (req, res) => {
    const q = query<{ page: number; limit: number; search?: string; centre?: string; track?: string; batch?: string }>(req);
    const { items, total } = await studentService.list(q);
    ApiResponse.ok(res, items, 'Students', buildMeta(q, total));
  }));

studentRouter.get('/:id', authorizePermission('imports.view'), validateRequest({ params: batchParams }), asyncHandler(async (req, res) => {
  ApiResponse.ok(res, await studentService.get(params<{ id: string }>(req).id), 'Student');
}));
