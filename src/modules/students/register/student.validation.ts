import { z } from 'zod';
import { idParams, uuid } from '../../../shared/validation/common.validation';
import { STUDENT_SOURCE } from '../student.constants';

export const listStudentsSchema = {
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(25),
    search: z.string().trim().max(100).optional(),
    centre: z.string().max(10).optional(),
    track: z.string().max(4).optional().describe('Track code (T01–T12), or TBC for "to be confirmed"'),
    batch: uuid.optional(),
    /* Imported students and registrations share the students table; omit for both. */
    source: z.enum([STUDENT_SOURCE.IMPORT, STUDENT_SOURCE.PUBLIC_REGISTRATION]).optional(),
  }),
};
export const studentIdSchema = { params: idParams };
export const studentDocumentSchema = { params: idParams.extend({ documentId: uuid }) };

export type ListStudentsQuery = z.infer<typeof listStudentsSchema.query>;
