import type { ImportBatch } from './import-batch.entity';

/* API shape of an import batch: the stored file checksum and soft-delete flags stay internal. */
export const toImportBatchDto = (b: ImportBatch) => ({
  id: b.id,
  code: b.code,
  status: b.status,
  sourceChannel: b.sourceChannel,
  fileName: b.fileName,
  fileSize: b.fileSize,
  sourceReference: b.sourceReference,
  counts: b.counts,
  columnMapping: b.columnMapping,
  ignoredColumns: b.ignoredColumns,
  failureReason: b.failureReason,
  documentsReport: b.documentsReport ?? null,
  createdById: b.createdById,
  finalisedById: b.finalisedById,
  finalisedAt: b.finalisedAt,
  createdAt: b.createdAt,
  updatedAt: b.updatedAt,
});
