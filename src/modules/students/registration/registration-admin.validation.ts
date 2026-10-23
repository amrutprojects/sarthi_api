import { z } from 'zod';
import { listQuerySchema } from '../../../shared/utils/pagination';
import { idParams, statusBody, uuid } from '../../../shared/validation/common.validation';
import { BARCODE_FORMAT_MESSAGE, BARCODE_RE, STUDENT_SOURCE, STUDENT_STATUS } from '../student.constants';
import { registrationBody } from './registration.validation';

export const REGISTRATION_SORT_FIELDS = ['createdAt', 'code', 'firstName'] as const;
export type RegistrationSortField = (typeof REGISTRATION_SORT_FIELDS)[number];

export const listRegistrationsSchema = {
  query: listQuerySchema(REGISTRATION_SORT_FIELDS).extend({
    status: z.enum([STUDENT_STATUS.REGISTRATION_PENDING]).optional(),
    source: z.enum([STUDENT_SOURCE.IMPORT, STUDENT_SOURCE.PUBLIC_REGISTRATION]).optional().describe('Omit for both'),
  }),
};
export type ListRegistrationsQuery = z.infer<typeof listRegistrationsSchema.query>;

export const registrationIdSchema = { params: idParams };

/* Editing a student: the same personal and course fields as a registration (documents and declaration are not edited). */
export const editRegistrationSchema = {
  params: idParams,
  body: registrationBody.omit({ documents: true, declaration_accepted: true }).strict(),
};
export type EditRegistrationBody = z.infer<typeof editRegistrationSchema.body>;
export const registrationStatusSchema = { params: idParams, body: statusBody };
export const registrationDocumentSchema = { params: idParams.extend({ documentId: uuid }) };

/*
 * Admin-entered registration (multipart): field "data" holds this JSON; each document file is sent in a field named
 * after its document type code (PHOTO, AADHAAR_CARD, …). Documents come from the files, so "documents" is not accepted.
 */
/*
 * Barcodes per document type code. An empty value means "none given": whether one is required is decided with the
 * files (a required barcode is needed only when that document is uploaded).
 */
export const barcodeMap = z.record(
  z
    .string()
    .trim()
    .refine((v) => v === '' || BARCODE_RE.test(v), `Barcode ${BARCODE_FORMAT_MESSAGE}`),
);

export const adminRegistrationData = registrationBody
  .omit({ documents: true })
  .extend({
    barcodes: barcodeMap
      .optional()
      .describe('Barcode per document type code, e.g. { "INCOME_EWS": "…" }'),
  })
  .strict();
export type AdminRegistrationData = z.infer<typeof adminRegistrationData>;
