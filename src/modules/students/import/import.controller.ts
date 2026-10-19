import type { Request, Response } from 'express';
import { env } from '../../../config/env.config';
import { body, params, query } from '../../../middleware/validate-request.middleware';
import { AppError } from '../../../shared/errors/app-error';
import { ApiResponse } from '../../../shared/http/api-response';
import { asyncHandler } from '../../../shared/http/async-handler';
import { buildMeta } from '../../../shared/utils/pagination';
import { studentService } from '../register/student.service';
import { BATCH_STATUS } from '../student.constants';
import { toImportBatchDto } from './import-batch.mapper';
import { importService } from './import.service';
import type { DecideBody, ListBatchesQuery, ListRowsQuery } from './import.validation';

type BatchParams = { id: string };
type RowParams = { id: string; rowId: string };

/* HTTP adapter for the import workflow: read the validated request, call importService, shape the response. */
export const importController = {
  template: (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="student-import-template.csv"');
    res.send(studentService.template());
  },

  reference: (_req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      { ...studentService.reference(), maxFileMb: env.IMPORT_MAX_FILE_MB, maxRows: env.IMPORT_MAX_ROWS },
      'Import reference',
    );
  },

  list: asyncHandler(async (req: Request, res: Response) => {
    const q = query<ListBatchesQuery>(req);
    const { items, total } = await importService.listBatches(q);
    ApiResponse.ok(res, items.map(toImportBatchDto), 'Import batches', buildMeta(q, total));
  }),

  upload: asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw AppError.badRequest('Attach a CSV or XLSX file in the "file" field');
    const raw: unknown = req.body?.sourceReference;
    const sourceReference = typeof raw === 'string' ? raw.trim().slice(0, 120) || null : null;
    const { batch, duplicate } = await importService.createFromFile(req.file, sourceReference, req.auth!, req);
    if (duplicate) {
      ApiResponse.ok(res, toImportBatchDto(batch), `This file was already uploaded as ${batch.code}; the existing batch is shown`);
      return;
    }
    const message = batch.status === BATCH_STATUS.IMPORT_FAILED ? `Import failed: ${batch.failureReason}` : 'File received and validated';
    ApiResponse.created(res, toImportBatchDto(batch), message);
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, toImportBatchDto(await importService.getBatch(params<BatchParams>(req).id)), 'Import batch');
  }),

  rows: asyncHandler(async (req: Request, res: Response) => {
    const q = query<ListRowsQuery>(req);
    const { items, total } = await importService.listRows(params<BatchParams>(req).id, q);
    ApiResponse.ok(res, items, 'Import rows', buildMeta(q, total));
  }),

  accept: asyncHandler(async (req: Request, res: Response) => {
    const p = params<RowParams>(req);
    ApiResponse.ok(
      res,
      await importService.acceptIssues(p.id, p.rowId, body<{ reason: string }>(req).reason, req.auth!, req),
      'Issues accepted with reason',
    );
  }),

  reject: asyncHandler(async (req: Request, res: Response) => {
    const p = params<RowParams>(req);
    ApiResponse.ok(res, await importService.rejectRow(p.id, p.rowId, body<{ reason: string }>(req).reason, req), 'Row rejected');
  }),

  restore: asyncHandler(async (req: Request, res: Response) => {
    const p = params<RowParams>(req);
    ApiResponse.ok(res, await importService.restoreRow(p.id, p.rowId, req), 'Row restored');
  }),

  decide: asyncHandler(async (req: Request, res: Response) => {
    const p = params<RowParams>(req);
    const b = body<DecideBody>(req);
    ApiResponse.ok(res, await importService.decide(p.id, p.rowId, b.decision, b.reason, req.auth!, req), 'Decision recorded');
  }),

  finalise: asyncHandler(async (req: Request, res: Response) => {
    const batch = await importService.finalise(params<BatchParams>(req).id, body<{ confirmCode: string }>(req).confirmCode, req.auth!, req);
    ApiResponse.ok(
      res,
      toImportBatchDto(batch),
      `Batch finalised: ${batch.counts.created ?? 0} students created, ${batch.counts.linked ?? 0} linked`,
    );
  }),

  cancel: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, toImportBatchDto(await importService.cancel(params<BatchParams>(req).id, req.auth!, req)), 'Batch cancelled');
  }),
};
