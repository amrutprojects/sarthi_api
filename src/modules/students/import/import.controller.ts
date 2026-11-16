import type { Request, Response } from 'express';
import { MESSAGES } from '../../../constants/api-response.constants';
import { env } from '../../../config/env.config';
import { body, params, query } from '../../../middleware/validate-request.middleware';
import { AppError } from '../../../shared/errors/app-error';
import { ApiResponse } from '../../../utils/api-response';
import { asyncHandler } from '../../../shared/http/async-handler';
import { buildMeta } from '../../../shared/utils/pagination';
import { sampleDocumentsZip, templateXlsx } from '../register/import-template';
import { studentService } from '../register/student.service';
import fs from 'fs/promises';
import { documentService } from '../documents/document.service';
import { sendFile } from '../documents/send-file';
import { BATCH_STATUS } from '../student.constants';
import { uploadedFile } from './upload.middleware';
import { toImportBatchDto } from './import-batch.mapper';
import { importService } from './import.service';
import type { AcceptAllBody, DecideBody, ListBatchesQuery, ListRowsQuery } from './import.validation';

type BatchParams = { id: string };
type RowParams = { id: string; rowId: string };

/* HTTP adapter for the import workflow: read the validated request, call importService, shape the response. */
export const importController = {
  template: (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="student-import-template.csv"');
    res.send(studentService.template());
  },

  templateXlsx: asyncHandler(async (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="student-import-template.xlsx"');
    res.send(await templateXlsx());
  }),

  sampleDocuments: asyncHandler(async (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="sample-documents.zip"');
    res.send(await sampleDocumentsZip());
  }),

  reference: (_req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      { ...studentService.reference(), maxFileMb: env.IMPORT_MAX_FILE_MB, maxRows: env.IMPORT_MAX_ROWS },
      MESSAGES.retrieved('Import reference'),
    );
  },

  list: asyncHandler(async (req: Request, res: Response) => {
    const q = query<ListBatchesQuery>(req);
    const { items, total } = await importService.listBatches(q);
    ApiResponse.ok(res, items.map(toImportBatchDto), MESSAGES.retrieved('Import batches'), buildMeta(q, total));
  }),

  /* Data file (required) and, optionally, the documents ZIP in the same request. */
  upload: asyncHandler(async (req: Request, res: Response) => {
    const data = uploadedFile(req, 'file');
    if (!data) throw AppError.badRequest('Attach a CSV or XLSX file in the "file" field');
    const raw: unknown = req.body?.sourceReference;
    const sourceReference = typeof raw === 'string' ? raw.trim().slice(0, 120) || null : null;
    const buffer = await fs.readFile(data.path);
    const { batch, duplicate } = await importService.createFromFile(
      { buffer, originalname: data.originalname, size: data.size },
      sourceReference,
      req.auth!,
      req,
    );
    if (duplicate) {
      ApiResponse.ok(res, toImportBatchDto(batch), `This file was already uploaded as ${batch.code}; the existing batch is shown`);
      return;
    }
    if (batch.status === BATCH_STATUS.IMPORT_FAILED) {
      ApiResponse.created(res, toImportBatchDto(batch), `Import failed: ${batch.failureReason}`);
      return;
    }
    const zip = uploadedFile(req, 'documents');
    if (!zip) {
      ApiResponse.created(res, toImportBatchDto(batch), 'File received and validated');
      return;
    }
    const withDocs = await documentService.attachZip(batch.id, zip, req.auth!, req);
    const r = withDocs.documentsReport!;
    ApiResponse.created(
      res,
      toImportBatchDto(withDocs),
      `File received and validated; ${r.stored} documents stored for ${r.studentsWithFiles} students`,
    );
  }),

  /* Add or replace documents of a batch under review. */
  uploadDocuments: asyncHandler(async (req: Request, res: Response) => {
    const zip = uploadedFile(req, 'documents');
    if (!zip) throw AppError.badRequest('Attach a ZIP file in the "documents" field');
    const batch = await documentService.attachZip(params<BatchParams>(req).id, zip, req.auth!, req);
    const r = batch.documentsReport!;
    ApiResponse.ok(
      res,
      toImportBatchDto(batch),
      `${r.stored} documents stored, ${r.rejected.length} rejected, ${r.unmatchedFolders.length} folders not matched`,
    );
  }),

  rowDocuments: asyncHandler(async (req: Request, res: Response) => {
    const p = params<RowParams>(req);
    ApiResponse.ok(res, await documentService.listForRow(p.id, p.rowId), MESSAGES.retrieved('Row documents'));
  }),

  rowDocumentFile: asyncHandler(async (req: Request, res: Response) => {
    const p = params<RowParams & { documentId: string }>(req);
    sendFile(res, await documentService.openStaged(p.id, p.rowId, p.documentId, req));
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, toImportBatchDto(await importService.getBatch(params<BatchParams>(req).id)), MESSAGES.retrieved('Import batch'));
  }),

  rows: asyncHandler(async (req: Request, res: Response) => {
    const q = query<ListRowsQuery>(req);
    const { items, total } = await importService.listRows(params<BatchParams>(req).id, q);
    ApiResponse.ok(res, items, MESSAGES.retrieved('Import rows'), buildMeta(q, total));
  }),

  accept: asyncHandler(async (req: Request, res: Response) => {
    const p = params<RowParams>(req);
    ApiResponse.ok(
      res,
      await importService.acceptIssues(p.id, p.rowId, body<{ reason: string }>(req).reason, req.auth!, req),
      'Issues accepted with reason',
    );
  }),

  /* Accept the waivable issues of every exception row with one reason (rows with a non-waivable issue are left). */
  acceptAll: asyncHandler(async (req: Request, res: Response) => {
    const b = body<AcceptAllBody>(req);
    const r = await importService.acceptAllIssues(params<BatchParams>(req).id, b.reason, b.code, req.auth!, req);
    ApiResponse.ok(
      res,
      { batch: toImportBatchDto(r.batch), accepted: r.accepted, skipped: r.skipped },
      `Issues accepted on ${r.accepted} rows` +
        (r.skipped ? `; ${r.skipped} rows have issues that cannot be waived (correct them at the source or reject them)` : ''),
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
