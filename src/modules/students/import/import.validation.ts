import { z } from 'zod';
import { uuid } from '../../../shared/validation/common.validation';
import { BATCH_STATUS, ROW_STATUS } from '../student.constants';

const page = { page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(200).default(25) };
const search = z.string().trim().max(100).optional();
const reason = z.string().trim().min(3, 'Give a reason (at least 3 characters)').max(500);
export const batchParams = z.object({ id: uuid });
export const rowParams = z.object({ id: uuid, rowId: uuid });

export const listBatchesSchema = { query: z.object({ ...page, search, status: z.nativeEnum(BATCH_STATUS).optional() }) };
export const batchIdSchema = { params: batchParams };
export const listRowsSchema = {
  params: batchParams,
  query: z.object({ ...page, search, status: z.nativeEnum(ROW_STATUS).optional(), issue: z.string().max(40).optional() }),
};
export const reasonSchema = { params: rowParams, body: z.object({ reason }).strict() };
export const restoreRowSchema = { params: rowParams, body: z.object({}).strict() };
export const decideSchema = {
  params: rowParams,
  body: z.object({ decision: z.enum(['SAME_PERSON', 'DIFFERENT_PERSON', 'HOLD']), reason }).strict(),
};
export const finaliseSchema = { params: batchParams, body: z.object({ confirmCode: z.string().trim().min(1).max(20) }).strict() };

/* Multipart upload fields (enforced by multer and the service; declared here for OpenAPI). */
export const uploadForm = z.object({
  file: z.string().describe('CSV (UTF-8) or XLSX file'),
  sourceReference: z.string().max(120).optional().describe('Transmittal or API batch reference'),
});

export type ListBatchesQuery = z.infer<typeof listBatchesSchema.query>;
export type ListRowsQuery = z.infer<typeof listRowsSchema.query>;
export type DecideBody = z.infer<typeof decideSchema.body>;
