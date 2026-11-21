import { z } from 'zod';
import { idParams } from '../../../shared/validation/common.validation';

/* Same limits and wording as the import's decide (import.validation.ts). */
const reason = z.string().trim().min(3, 'Give a reason (at least 3 characters)').max(500);

export const listReviewsSchema = {
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(200).default(25),
      status: z.enum(['PENDING', 'DECIDED']).optional(),
    })
    .strict(),
};
export const reviewIdSchema = { params: idParams };
export const decideReviewSchema = {
  params: idParams,
  body: z.object({ decision: z.enum(['SAME_PERSON', 'DIFFERENT_PERSON', 'HOLD']), reason }).strict(),
};

export type ListReviewsQuery = z.infer<typeof listReviewsSchema.query>;
export type DecideReviewBody = z.infer<typeof decideReviewSchema.body>;

/* The LMS request bodies (documentation only: the service validates them so a refusal is a 400 with {field, code}). */
const s = z.string();
export const lmsMatchBody = z.object({
  source_record_id: s.nullable().optional(),
  aadhaar_number: s.nullable().optional().describe('Only when the LMS has it in hand; never stored by the match'),
  first_name: s,
  last_name: s,
  date_of_birth: s.describe('YYYY-MM-DD'),
  mobile_number: s.describe('10 digits'),
  email: s.nullable().optional(),
});
export const lmsMatchAnswer = z.object({
  result: z.enum(['NONE', 'MATCH', 'POSSIBLE']),
  tier: z.enum(['T0', 'T1', 'T2', 'T3']).nullable(),
  student_id: z.string().uuid().nullable(),
  student_code: z.string().nullable(),
});
export const lmsCreateBody = z
  .object({
    first_name: s,
    last_name: s,
    father_name: s,
    mother_name: s,
    email: s,
    date_of_birth: s,
    gender: s,
    permanent_address: s,
    landmark: s,
    district: s,
    taluka: s,
    division: s,
    pin_code: s,
    mobile_number: s,
    lms_tenant_code: s,
    lms_learner_ref: s,
    source_record_id: s.optional(),
    aadhaar_number: s.optional(),
    marital_status: s.optional(),
    alternate_mobile_number: s.optional(),
    alternate_email: s.optional(),
    course_centre: s.optional(),
    technology: s.optional(),
    scheme_name: s.optional(),
    education_qualification: s.optional(),
    qualification_name: s.optional(),
    qualification_stream: s.optional(),
    qualification_board: s.optional(),
    qualification_completed_on: s.optional(),
    score: z.union([s, z.number()]).optional(),
    score_type: s.optional(),
    qualification_class: s.optional(),
  })
  .describe('Header Idempotency-Key is required (the LMS request id).');
export const lmsCreateAnswer = z.object({
  result: z.enum(['CREATED', 'MATCHED', 'REVIEW']),
  student_id: z.string().uuid(),
  student_code: z.string().optional().describe('Absent on REVIEW'),
});
export const lmsUpdateBody = z
  .object({ source_updated_at: s.describe('ISO 8601 date-time of the correction') })
  .catchall(s)
  .describe(
    'The changed fields (first_name, last_name, father_name, mother_name, email, date_of_birth, mobile_number, gender, marital_status, permanent_address, landmark, district, taluka, division, pin_code, alternate_mobile_number, alternate_email) plus source_updated_at.',
  );
export const lmsUpdateAnswer = z.object({ result: z.literal('UPDATED') });
export const lmsStudentParams = z.object({ studentId: z.string().uuid() });
