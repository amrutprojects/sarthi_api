import { z } from 'zod';
import { idParams, uuid } from '../../../shared/validation/common.validation';
import { STUDENT_SOURCE } from '../student.constants';
import { STUDENT_BUCKETS } from './student.types';

export const listStudentsSchema = {
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(25),
    search: z.string().trim().max(100).optional(),
    centre: z.string().max(10).optional(),
    track: z.string().max(4).optional().describe('Track code (T01–T12), or none (TBC also accepted) for "to be confirmed"'),
    batch: uuid.optional().describe('Import batch id'),
    /* Imported students and registrations share the students table; omit for both. */
    source: z.enum([STUDENT_SOURCE.IMPORT, STUDENT_SOURCE.PUBLIC_REGISTRATION]).optional(),
    bucket: z
      .enum(STUDENT_BUCKETS)
      .optional()
      .describe(
        'applications = all; pending = REGISTRATION_PENDING; eligible = RECEIVED and active; enrolled = eligible with a live batch assignment; awaiting = eligible without one',
      ),
    casteId: uuid.optional(),
    educationId: uuid.optional(),
    regionId: uuid.optional(),
  }),
};
export const studentSummarySchema = {
  query: z.object({
    centre: z.string().trim().max(10).optional().describe('District (region) code; omit for every district'),
  }),
};
export const studentIdSchema = { params: idParams };
export const studentDocumentSchema = { params: idParams.extend({ documentId: uuid }) };

export type ListStudentsQuery = z.infer<typeof listStudentsSchema.query>;
export type StudentSummaryQuery = z.infer<typeof studentSummarySchema.query>;
