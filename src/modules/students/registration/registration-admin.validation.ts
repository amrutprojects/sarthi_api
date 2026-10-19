import { z } from 'zod';
import { listQuerySchema } from '../../../shared/utils/pagination';
import { idParams } from '../../../shared/validation/common.validation';
import { STUDENT_STATUS } from '../student.constants';
import { registrationBody } from './registration.validation';

export const REGISTRATION_SORT_FIELDS = ['createdAt', 'code', 'firstName'] as const;
export type RegistrationSortField = (typeof REGISTRATION_SORT_FIELDS)[number];

export const listRegistrationsSchema = {
  query: listQuerySchema(REGISTRATION_SORT_FIELDS).extend({
    status: z.enum([STUDENT_STATUS.REGISTRATION_PENDING]).optional(),
  }),
};
export type ListRegistrationsQuery = z.infer<typeof listRegistrationsSchema.query>;

export const registrationIdSchema = { params: idParams };

/*
 * Admin-entered registration (multipart): field "data" holds this JSON; each document file is sent in a field named
 * after its document type code (PHOTO, AADHAAR_CARD, …). Documents come from the files, so "documents" is not accepted.
 */
export const adminRegistrationData = registrationBody
  .omit({ documents: true })
  .extend({
    barcodes: z
      .record(z.string().trim().max(64, 'Barcode must be at most 64 characters'))
      .optional()
      .describe('Barcode per document type code, e.g. { "INCOME_EWS": "…" }'),
  })
  .strict();
export type AdminRegistrationData = z.infer<typeof adminRegistrationData>;
