import { z } from 'zod';
import { documentEndpoint, envelope, pagedEnvelope, registry } from '../../shared/openapi/registry';
import {
  batchIdSchema,
  documentsForm,
  rowDocumentSchema,
  rowParamsSchema,
  decideSchema,
  finaliseSchema,
  listBatchesSchema,
  listRowsSchema,
  reasonSchema,
  restoreRowSchema,
  uploadForm,
} from './import/import.validation';
import { listStudentsSchema, studentDocumentSchema, studentIdSchema } from './register/student.validation';
import { BATCH_STATUS, ROW_STATUS } from './student.constants';
import { registrationBody } from './registration/registration.validation';
import { listRegistrationsSchema, registrationIdSchema } from './registration/registration-admin.validation';

const Counts = z.object({
  total: z.number().int(),
  valid: z.number().int(),
  exceptions: z.number().int(),
  duplicates: z.number().int(),
  skipped: z.number().int(),
  rejected: z.number().int(),
  reconciled: z.number().int(),
  created: z.number().int().optional(),
  linked: z.number().int().optional(),
});
const DocumentsReportDto = z.object({
  zipName: z.string(),
  uploadedAt: z.string().datetime(),
  stored: z.number().int(),
  matchedByPath: z.number().int().optional(),
  replaced: z.number().int(),
  studentsWithFiles: z.number().int(),
  unmatchedFolders: z.array(z.string()),
  rejected: z.array(z.object({ path: z.string(), reason: z.string() })),
  missingReferenced: z
    .array(z.object({ rowNumber: z.number().int(), sourceRecordId: z.string().nullable(), docType: z.string(), path: z.string() }))
    .optional(),
});
export const StudentDocumentDto = registry.register(
  'StudentDocument',
  z.object({
    id: z.string().uuid(),
    docType: z.string(),
    label: z.string(),
    originalName: z.string(),
    sourcePath: z.string().nullable(),
    mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
    sizeBytes: z.number().int(),
    uploadedAt: z.string().datetime(),
  }),
);
export const ImportBatchDto = registry.register(
  'ImportBatch',
  z.object({
    id: z.string().uuid(),
    code: z.string(),
    status: z.nativeEnum(BATCH_STATUS),
    sourceChannel: z.string(),
    fileName: z.string(),
    fileSize: z.number().int(),
    sourceReference: z.string().nullable(),
    counts: Counts,
    columnMapping: z.record(z.string()),
    ignoredColumns: z.array(z.string()),
    failureReason: z.string().nullable(),
    documentsReport: DocumentsReportDto.nullable(),
    createdById: z.string().uuid(),
    finalisedById: z.string().uuid().nullable(),
    finalisedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
);
const Issue = z.object({
  field: z.string(),
  code: z.string(),
  message: z.string(),
  status: z.enum(['OPEN', 'ACCEPTED']),
  reason: z.string().optional(),
});
const ImportRowDto = registry.register(
  'ImportRow',
  z
    .object({
      id: z.string().uuid(),
      rowNumber: z.number().int(),
      status: z.nativeEnum(ROW_STATUS),
      sourceRecordId: z.string().nullable(),
      name: z.string(),
      email: z.string().nullable().describe('masked'),
      mobile: z.string().nullable().describe('masked'),
      aadhaar: z.string().nullable().describe('masked: XXXX-XXXX-1234'),
      issues: z.array(Issue),
      match: z
        .object({
          tier: z.string(),
          studentId: z.string().uuid().nullable(),
          rowNumber: z.number().int().nullable(),
          note: z.string().nullable(),
        })
        .nullable(),
      decision: z.string().nullable(),
      decisionReason: z.string().nullable(),
      rejectReason: z.string().nullable(),
      studentId: z.string().uuid().nullable(),
    })
    .passthrough(),
);
const StudentDto = registry.register(
  'Student',
  z
    .object({
      id: z.string().uuid(),
      code: z.string(),
      sourceRecordId: z.string().nullable(),
      name: z.string(),
      centreCode: z.string().nullable(),
      centreName: z.string().nullable(),
      trackCode: z.string().nullable(),
      trackName: z.string().nullable(),
      trackToBeConfirmed: z.boolean(),
      status: z.string(),
      mobile: z.string().nullable(),
      email: z.string().nullable(),
      aadhaar: z.string().nullable(),
      approvedAt: z.string().datetime().nullable(),
      importBatchId: z.string().uuid(),
      createdAt: z.string().datetime(),
      documents: z
        .array(
          z.object({ key: z.string(), label: z.string(), required: z.boolean(), supplied: z.boolean(), barcode: z.string().nullable() }),
        )
        .optional(),
    })
    .passthrough(),
);
const Reference = z.object({
  columns: z.array(z.object({ field: z.string(), label: z.string(), required: z.boolean() })),
  tracks: z.array(z.object({ code: z.string(), name: z.string(), aliases: z.array(z.string()) })),
  centres: z.array(z.object({ code: z.string(), name: z.string() })),
  maxFileMb: z.number(),
  maxRows: z.number(),
});

const tag = 'Student import';
documentEndpoint({
  method: 'get',
  path: '/imports/template.csv',
  tag,
  summary: 'Download the CSV column template (synthetic example rows)',
  permission: 'imports.view',
  response: { file: 'text/csv' },
});
documentEndpoint({
  method: 'get',
  path: '/imports/reference',
  tag,
  summary: 'Columns, tracks, centres and limits',
  permission: 'imports.view',
  response: envelope(Reference),
});
documentEndpoint({
  method: 'get',
  path: '/imports',
  tag,
  summary: 'List import batches',
  permission: 'imports.view',
  request: { query: listBatchesSchema.query },
  response: pagedEnvelope(ImportBatchDto),
});
documentEndpoint({
  method: 'post',
  path: '/imports',
  tag,
  summary: 'Upload and validate an approved-student file',
  description:
    'CSV (UTF-8) or XLSX, detected by content. Returns 201 with the new batch (status READY_TO_FINALISE, VALIDATED_WITH_EXCEPTIONS or IMPORT_FAILED), or 200 with the existing batch when the same file was uploaded before.',
  permission: 'imports.create',
  request: { multipart: uploadForm },
  response: envelope(ImportBatchDto),
  errors: [400],
});
documentEndpoint({
  method: 'get',
  path: '/imports/:id',
  tag,
  summary: 'Get an import batch with counts',
  permission: 'imports.view',
  request: { params: batchIdSchema.params },
  response: envelope(ImportBatchDto),
  errors: [404],
});
documentEndpoint({
  method: 'get',
  path: '/imports/:id/rows',
  tag,
  summary: 'Rows of a batch (masked preview)',
  permission: 'imports.view',
  request: { params: listRowsSchema.params, query: listRowsSchema.query },
  response: pagedEnvelope(ImportRowDto),
  errors: [404],
});
documentEndpoint({
  method: 'post',
  path: '/imports/:id/rows/:rowId/accept',
  tag,
  summary: 'Accept waivable issues with a reason',
  permission: 'imports.update',
  status: 200,
  request: { params: reasonSchema.params, body: reasonSchema.body },
  response: envelope(ImportRowDto),
  errors: [400, 404, 409],
});
documentEndpoint({
  method: 'post',
  path: '/imports/:id/rows/:rowId/reject',
  tag,
  summary: 'Reject a row',
  permission: 'imports.update',
  status: 200,
  request: { params: reasonSchema.params, body: reasonSchema.body },
  response: envelope(ImportRowDto),
  errors: [404, 409],
});
documentEndpoint({
  method: 'post',
  path: '/imports/:id/rows/:rowId/restore',
  tag,
  summary: 'Restore a rejected row',
  permission: 'imports.update',
  status: 200,
  request: { params: restoreRowSchema.params, body: restoreRowSchema.body },
  response: envelope(ImportRowDto),
  errors: [404, 409],
});
documentEndpoint({
  method: 'post',
  path: '/imports/:id/rows/:rowId/decide',
  tag,
  summary: 'Decide a possible duplicate',
  permission: 'imports.update',
  status: 200,
  request: { params: decideSchema.params, body: decideSchema.body },
  response: envelope(ImportRowDto),
  errors: [404, 409],
});
documentEndpoint({
  method: 'post',
  path: '/imports/:id/finalise',
  tag,
  summary: 'Finalise a batch into the register (second person)',
  description: 'Allowed only for READY_TO_FINALISE batches, by someone other than the uploader, typing the batch code. One transaction.',
  permission: 'imports.approve',
  status: 200,
  idempotent: true,
  request: { params: finaliseSchema.params, body: finaliseSchema.body },
  response: envelope(ImportBatchDto),
  errors: [400, 404, 409],
});
documentEndpoint({
  method: 'post',
  path: '/imports/:id/cancel',
  tag,
  summary: 'Cancel a batch before finalisation',
  permission: 'imports.delete',
  status: 200,
  request: { params: batchIdSchema.params },
  response: envelope(ImportBatchDto),
  errors: [404, 409],
});

const reg = 'Student register';
documentEndpoint({
  method: 'get',
  path: '/students',
  tag: reg,
  summary: 'List students (masked)',
  permission: 'imports.view',
  request: { query: listStudentsSchema.query },
  response: pagedEnvelope(StudentDto),
});
documentEndpoint({
  method: 'get',
  path: '/students/:id',
  tag: reg,
  summary: 'Student detail (masked)',
  permission: 'imports.view',
  request: { params: studentIdSchema.params },
  response: envelope(StudentDto),
  errors: [404],
});

const docs = 'Student documents';
documentEndpoint({
  method: 'post',
  path: '/imports/:id/documents',
  tag: docs,
  summary: 'Upload a documents ZIP for a batch under review',
  description:
    'One folder per student named by source_record_id (or files named <id>_<TYPE>.pdf). Files must be PDF, JPG or PNG by content and at most DOCUMENT_MAX_FILE_MB. Documents of the same type are replaced. The batch documentsReport lists stored, rejected and unmatched files.',
  permission: 'imports.update',
  status: 200,
  request: { params: batchIdSchema.params, multipart: documentsForm },
  response: envelope(ImportBatchDto),
  errors: [400, 404, 409],
});
documentEndpoint({
  method: 'get',
  path: '/imports/:id/rows/:rowId/documents',
  tag: docs,
  summary: 'Documents staged for a row',
  permission: 'imports.view',
  request: { params: rowParamsSchema.params },
  response: envelope(z.array(StudentDocumentDto)),
});
documentEndpoint({
  method: 'get',
  path: '/imports/:id/rows/:rowId/documents/:documentId/file',
  tag: docs,
  summary: 'Download a staged document (audited)',
  permission: 'imports.view',
  request: { params: rowDocumentSchema.params },
  response: { file: 'application/octet-stream' },
  errors: [404],
});
documentEndpoint({
  method: 'get',
  path: '/students/:id/documents',
  tag: docs,
  summary: "A student's documents (stored in the student's own folder)",
  permission: 'imports.view',
  request: { params: studentIdSchema.params },
  response: envelope(z.array(StudentDocumentDto)),
  errors: [404],
});
documentEndpoint({
  method: 'get',
  path: '/students/:id/documents/:documentId/file',
  tag: docs,
  summary: 'Download a student document (audited)',
  permission: 'imports.view',
  request: { params: studentDocumentSchema.params },
  response: { file: 'application/octet-stream' },
  errors: [404],
});

documentEndpoint({
  method: 'get',
  path: '/imports/template.xlsx',
  tag: 'Student import',
  summary: 'Download the Excel template (document columns hold file paths inside the ZIP; includes an instructions sheet)',
  permission: 'imports.view',
  response: { file: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
});
documentEndpoint({
  method: 'get',
  path: '/imports/sample-documents.zip',
  tag: 'Student import',
  summary: 'Download a sample documents ZIP matching the template paths',
  permission: 'imports.view',
  response: { file: 'application/zip' },
});

const RegistrationExample = {
  first_name: 'Asha',
  last_name: 'Patil',
  father_name: 'Ramesh Patil',
  mother_name: 'Sunita Patil',
  email: 'asha.patil@example.com',
  date_of_birth: '2003-04-12',
  current_address: 'Flat 4, Shivaji Nagar, Pune 411005',
  aadhaar_number: '<12-digit Aadhaar>',
  mobile_number: '9876543210',
  religion: 'हिंदू',
  caste_id: '3f1c2a9e-5b7d-4e61-9a0b-2c4d6e8f1a01',
  region_id: '7a2b4c6d-8e0f-4a1b-9c3d-5e7f9a1b3c02',
  technology: 'T03',
  education_id: 'b4d6f8a0-2c4e-4f6a-8b0c-1d3e5f7a9b03',
  documents: [{ document_type_id: 'c5e7a9b1-3d5f-4a7b-9c1d-2e4f6a8b0c04' }],
  declaration_accepted: true as const,
};
documentEndpoint({
  method: 'post',
  path: '/student-registrations',
  tag: 'Student registration',
  summary: 'Submit a student registration from the public website',
  description: [
    'Uses the same fields, normalisation and validation as the student import (`validateCandidate`).',
    'The record is stored in the student register with status `REGISTRATION_PENDING`; it is never approved, allocated or',
    'linked to the LMS by this call. Client-supplied status, approval or ID fields are rejected (422).',
    'Region, caste, education and document types are ids of active master records (see the `/…/options` endpoints);',
    'an unknown, inactive or deleted id → 422 with the field. Same Aadhaar as an existing student or registration → 409.',
    'Rate limited per IP.',
  ].join(' '),
  permission: 'public',
  request: { body: registrationBody.openapi({ example: RegistrationExample }) },
  response: envelope(
    z.object({
      registration_id: z.string().openapi({ example: 'REG-000001' }),
      status: z.string().openapi({ example: 'REGISTRATION_PENDING' }),
    }),
  ),
  errors: [400, 409, 422],
});

/* Student Registration menu (admin panel). */
const RegistrationDto = registry.register('Registration', StudentDto.extend({ importBatchId: z.string().uuid().nullable() }));
const RegistrationDetailDto = registry.register(
  'RegistrationDetail',
  RegistrationDto.extend({
    files: z.array(
      z.object({
        id: z.string().uuid(),
        docType: z.string(),
        originalName: z.string(),
        mimeType: z.string(),
        sizeBytes: z.number().int(),
        uploadedAt: z.string().datetime(),
      }),
    ),
  }),
);
const regTag = 'Student registration';
documentEndpoint({
  method: 'get',
  path: '/student-registrations',
  tag: regTag,
  summary: 'List registrations (masked)',
  description: 'Server-side paging; search matches code, name, email, or the last four mobile digits.',
  permission: 'registrations.view',
  request: { query: listRegistrationsSchema.query },
  response: pagedEnvelope(RegistrationDto),
});
documentEndpoint({
  method: 'get',
  path: '/student-registrations/:id',
  tag: regTag,
  summary: 'Get a registration with its uploaded documents (masked)',
  permission: 'registrations.view',
  request: { params: registrationIdSchema.params },
  response: envelope(RegistrationDetailDto),
  errors: [404],
});
documentEndpoint({
  method: 'post',
  path: '/student-registrations/admin',
  tag: regTag,
  summary: 'Enter a registration with its document files (admin panel form)',
  description: [
    'multipart/form-data: field `data` is the registration JSON (as POST /student-registrations, without `documents`,',
    'plus optional `barcodes` per document type code). Each file goes in a field named after its document type code',
    '(PHOTO, AADHAAR_CARD, …): PDF, JPG, JPEG or PNG, at most 5 MB, type checked from the content. Mandatory document',
    'types need a file; INCOME_EWS needs its barcode. Same validation and duplicate rules as the public endpoint.',
  ].join(' '),
  permission: 'registrations.create',
  request: {
    multipart: z.object({
      data: z.string().describe('Registration JSON'),
      PHOTO: z.string().openapi({ type: 'string', format: 'binary' }).describe('One field per document type code'),
    }),
  },
  response: envelope(z.object({ id: z.string().uuid(), registration_id: z.string(), status: z.string() })),
  errors: [409, 422],
});
