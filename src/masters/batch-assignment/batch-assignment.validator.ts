import { z } from 'zod';
import { idParams, optionalText, statusBody, uuid } from '../../shared/validation/common.validation';
import { listQueryAscSchema } from '../../shared/utils/pagination';
import { ASSIGNMENT_REASONS } from '../shared/master.constants';

/* Optional reason: absent leaves it alone (update), empty or null clears it. */
const optionalReason = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.enum(ASSIGNMENT_REASONS).nullable().optional(),
);

export const listBatchAssignmentsSchema = {
  query: listQueryAscSchema(['studentName', 'studentCode', 'batchName', 'centreName', 'assignedAt', 'createdAt', 'updatedAt'] as const).extend({
    batchId: uuid.optional(),
    centreId: uuid.optional(),
    reasonCode: z.enum(ASSIGNMENT_REASONS).optional(),
  }),
};

/* Type-to-search feed: at least 2 characters, so the student register is never listed wholesale. */
export const studentOptionsSchema = {
  query: z.object({ search: z.string().trim().min(2, 'Type at least 2 characters').max(100, 'Must be at most 100 characters') }).strict(),
};

export const batchAssignmentIdSchema = { params: idParams };

export const createBatchAssignmentSchema = {
  body: z
    .object({
      batchId: uuid,
      studentId: uuid,
      reasonCode: optionalReason,
      remarks: optionalText(500),
      isActive: z.boolean().optional(),
    })
    .strict(),
};

/*
 * The student cannot be changed (a different student is a different assignment), so studentId is not
 * accepted here: .strict() turns it into a 422. The batch may change; the service then re-runs the batch,
 * seat and reason checks against the new batch.
 */
export const updateBatchAssignmentSchema = {
  params: idParams,
  body: z
    .object({ batchId: uuid.optional(), reasonCode: optionalReason, remarks: optionalText(500) })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
};

export const batchAssignmentStatusSchema = { params: idParams, body: statusBody };

export type ListBatchAssignmentsQuery = z.infer<typeof listBatchAssignmentsSchema.query>;
export type StudentOptionsQuery = z.infer<typeof studentOptionsSchema.query>;
export type CreateBatchAssignmentBody = z.infer<typeof createBatchAssignmentSchema.body>;
export type UpdateBatchAssignmentBody = z.infer<typeof updateBatchAssignmentSchema.body>;
