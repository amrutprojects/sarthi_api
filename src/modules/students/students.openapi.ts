import { z } from 'zod';
import { documentEndpoint, envelope, pagedEnvelope, registry } from '../../shared/openapi/registry';
import { batchIdSchema, decideSchema, finaliseSchema, listBatchesSchema, listRowsSchema, reasonSchema, restoreRowSchema, uploadForm } from './import/import.validation';
import { listStudentsSchema, studentIdSchema } from './register/student.validation';
import { BATCH_STATUS, ROW_STATUS } from './student.constants';

const Counts = z.object({
  total: z.number().int(), valid: z.number().int(), exceptions: z.number().int(), duplicates: z.number().int(),
  skipped: z.number().int(), rejected: z.number().int(), reconciled: z.number().int(), created: z.number().int().optional(), linked: z.number().int().optional(),
});
export const ImportBatchDto = registry.register('ImportBatch', z.object({
  id: z.string().uuid(), code: z.string(), status: z.nativeEnum(BATCH_STATUS), sourceChannel: z.string(), fileName: z.string(), fileSize: z.number().int(),
  sourceReference: z.string().nullable(), counts: Counts, columnMapping: z.record(z.string()), ignoredColumns: z.array(z.string()),
  failureReason: z.string().nullable(), createdById: z.string().uuid(), finalisedById: z.string().uuid().nullable(),
  finalisedAt: z.string().datetime().nullable(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}));
const Issue = z.object({ field: z.string(), code: z.string(), message: z.string(), status: z.enum(['OPEN', 'ACCEPTED']), reason: z.string().optional() });
const ImportRowDto = registry.register('ImportRow', z.object({
  id: z.string().uuid(), rowNumber: z.number().int(), status: z.nativeEnum(ROW_STATUS), sourceRecordId: z.string().nullable(),
  name: z.string(), email: z.string().nullable().describe('masked'), mobile: z.string().nullable().describe('masked'), aadhaar: z.string().nullable().describe('masked: XXXX-XXXX-1234'),
  issues: z.array(Issue),
  match: z.object({ tier: z.string(), studentId: z.string().uuid().nullable(), rowNumber: z.number().int().nullable(), note: z.string().nullable() }).nullable(),
  decision: z.string().nullable(), decisionReason: z.string().nullable(), rejectReason: z.string().nullable(), studentId: z.string().uuid().nullable(),
}).passthrough());
const StudentDto = registry.register('Student', z.object({
  id: z.string().uuid(), code: z.string(), sourceRecordId: z.string().nullable(), name: z.string(),
  centreCode: z.string().nullable(), centreName: z.string().nullable(), trackCode: z.string().nullable(), trackName: z.string().nullable(),
  trackToBeConfirmed: z.boolean(), status: z.string(), mobile: z.string().nullable(), email: z.string().nullable(), aadhaar: z.string().nullable(),
  approvedAt: z.string().datetime(), importBatchId: z.string().uuid(), createdAt: z.string().datetime(),
  documents: z.array(z.object({ key: z.string(), label: z.string(), required: z.boolean(), supplied: z.boolean(), barcode: z.string().nullable() })).optional(),
}).passthrough());
const Reference = z.object({
  columns: z.array(z.object({ field: z.string(), label: z.string(), required: z.boolean() })),
  tracks: z.array(z.object({ code: z.string(), name: z.string(), aliases: z.array(z.string()) })),
  centres: z.array(z.object({ code: z.string(), name: z.string() })), maxFileMb: z.number(), maxRows: z.number(),
});

const tag = 'Student import';
documentEndpoint({ method: 'get', path: '/imports/template.csv', tag, summary: 'Download the CSV column template (synthetic example rows)', permission: 'imports.view', response: { file: 'text/csv' } });
documentEndpoint({ method: 'get', path: '/imports/reference', tag, summary: 'Columns, tracks, centres and limits', permission: 'imports.view', response: envelope(Reference) });
documentEndpoint({ method: 'get', path: '/imports', tag, summary: 'List import batches', permission: 'imports.view', request: { query: listBatchesSchema.query }, response: pagedEnvelope(ImportBatchDto) });
documentEndpoint({
  method: 'post', path: '/imports', tag, summary: 'Upload and validate an approved-student file',
  description: 'CSV (UTF-8) or XLSX, detected by content. Returns 201 with the new batch (status READY_TO_FINALISE, VALIDATED_WITH_EXCEPTIONS or IMPORT_FAILED), or 200 with the existing batch when the same file was uploaded before.',
  permission: 'imports.create', request: { multipart: uploadForm }, response: envelope(ImportBatchDto), errors: [400],
});
documentEndpoint({ method: 'get', path: '/imports/:id', tag, summary: 'Get an import batch with counts', permission: 'imports.view', request: { params: batchIdSchema.params }, response: envelope(ImportBatchDto), errors: [404] });
documentEndpoint({ method: 'get', path: '/imports/:id/rows', tag, summary: 'Rows of a batch (masked preview)', permission: 'imports.view', request: { params: listRowsSchema.params, query: listRowsSchema.query }, response: pagedEnvelope(ImportRowDto), errors: [404] });
documentEndpoint({ method: 'post', path: '/imports/:id/rows/:rowId/accept', tag, summary: 'Accept waivable issues with a reason', permission: 'imports.update', status: 200, request: { params: reasonSchema.params, body: reasonSchema.body }, response: envelope(ImportRowDto), errors: [400, 404, 409] });
documentEndpoint({ method: 'post', path: '/imports/:id/rows/:rowId/reject', tag, summary: 'Reject a row', permission: 'imports.update', status: 200, request: { params: reasonSchema.params, body: reasonSchema.body }, response: envelope(ImportRowDto), errors: [404, 409] });
documentEndpoint({ method: 'post', path: '/imports/:id/rows/:rowId/restore', tag, summary: 'Restore a rejected row', permission: 'imports.update', status: 200, request: { params: restoreRowSchema.params, body: restoreRowSchema.body }, response: envelope(ImportRowDto), errors: [404, 409] });
documentEndpoint({ method: 'post', path: '/imports/:id/rows/:rowId/decide', tag, summary: 'Decide a possible duplicate', permission: 'imports.update', status: 200, request: { params: decideSchema.params, body: decideSchema.body }, response: envelope(ImportRowDto), errors: [404, 409] });
documentEndpoint({
  method: 'post', path: '/imports/:id/finalise', tag, summary: 'Finalise a batch into the register (second person)',
  description: 'Allowed only for READY_TO_FINALISE batches, by someone other than the uploader, typing the batch code. One transaction.',
  permission: 'imports.approve', status: 200, idempotent: true, request: { params: finaliseSchema.params, body: finaliseSchema.body }, response: envelope(ImportBatchDto), errors: [400, 404, 409],
});
documentEndpoint({ method: 'post', path: '/imports/:id/cancel', tag, summary: 'Cancel a batch before finalisation', permission: 'imports.delete', status: 200, request: { params: batchIdSchema.params }, response: envelope(ImportBatchDto), errors: [404, 409] });

const reg = 'Student register';
documentEndpoint({ method: 'get', path: '/students', tag: reg, summary: 'List students (masked)', permission: 'imports.view', request: { query: listStudentsSchema.query }, response: pagedEnvelope(StudentDto) });
documentEndpoint({ method: 'get', path: '/students/:id', tag: reg, summary: 'Student detail (masked)', permission: 'imports.view', request: { params: studentIdSchema.params }, response: envelope(StudentDto), errors: [404] });
