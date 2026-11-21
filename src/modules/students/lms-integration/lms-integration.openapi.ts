import { z } from 'zod';
import { documentEndpoint, envelope, pagedEnvelope, registry } from '../../../shared/openapi/registry';
import {
  decideReviewSchema,
  listReviewsSchema,
  lmsCreateAnswer,
  lmsCreateBody,
  lmsMatchAnswer,
  lmsMatchBody,
  lmsStudentParams,
  lmsUpdateAnswer,
  lmsUpdateBody,
  reviewIdSchema,
} from './lms-integration.validation';

/*
 * M1: the LMS student endpoints (X-Api-Key) and their review queue (contract amrut-student-api.md).
 */

const lmsTag = 'LMS integration (X-Api-Key)';
documentEndpoint({
  method: 'post',
  path: '/lms-integration/students/match',
  tag: lmsTag,
  summary: 'Duplicate check before the LMS creates a student (tiers T0–T3, the import’s rules)',
  description:
    'MATCH: T0, or T1 with the same name and date of birth. POSSIBLE: T1 conflict or T2. T3 is information only (NONE). Never returns the matched person’s values. Not wrapped in the envelope.',
  permission: 'public',
  apiKeyScope: 'lms.students.match',
  request: { body: lmsMatchBody },
  response: lmsMatchAnswer,
  status: 200,
  errors: [400],
});
documentEndpoint({
  method: 'post',
  path: '/lms-integration/students',
  tag: lmsTag,
  summary: 'Create-or-match a student entered in the LMS (source LMS, code LMS-000001)',
  description:
    'Idempotency-Key is required. 201 CREATED, 200 MATCHED, 202 REVIEW (held for Amrut’s same-person / different-person decision; retry with the same key to learn the outcome). 400 carries {field, code} pairs only. Not wrapped in the envelope.',
  permission: 'public',
  apiKeyScope: 'lms.students.create',
  request: { body: lmsCreateBody },
  response: lmsCreateAnswer,
  status: 201,
  errors: [400, 422],
});
documentEndpoint({
  method: 'patch',
  path: '/lms-integration/students/:studentId',
  tag: lmsTag,
  summary: 'Profile correction requested in the LMS',
  description:
    '200 UPDATED; 404 unknown student; 409 STALE when source_updated_at is older than Amrut’s last change. Not wrapped in the envelope.',
  permission: 'public',
  apiKeyScope: 'lms.students.update',
  request: { params: lmsStudentParams, body: lmsUpdateBody },
  response: lmsUpdateAnswer,
  errors: [400, 404, 409],
});

const ReviewDto = registry.register(
  'LmsStudentReview',
  z.object({
    id: z.string().uuid().describe('Also the student_id the LMS was given'),
    status: z.enum(['PENDING', 'DECIDED']),
    lmsTenantCode: z.string(),
    lmsLearnerRef: z.string(),
    name: z.string(),
    fatherName: z.string().nullable(),
    motherName: z.string().nullable(),
    dateOfBirth: z.string().nullable(),
    email: z.string().nullable().describe('Masked'),
    mobile: z.string().nullable().describe('Masked'),
    aadhaar: z.string().nullable().describe('Masked'),
    gender: z.string().nullable(),
    districtName: z.string().nullable(),
    talukaName: z.string().nullable(),
    match: z.object({ tier: z.string(), studentId: z.string().uuid(), studentCode: z.string().nullable(), note: z.string() }),
    decision: z.enum(['SAME_PERSON', 'DIFFERENT_PERSON', 'HOLD']).nullable(),
    decisionReason: z.string().nullable(),
    decidedById: z.string().uuid().nullable(),
    decidedAt: z.string().nullable(),
    studentId: z.string().uuid().nullable(),
    createdAt: z.string(),
  }),
);
const reviewTag = 'LMS integration reviews';
documentEndpoint({
  method: 'get',
  path: '/lms-integration-reviews',
  tag: reviewTag,
  summary: 'LMS creates held for review',
  permission: 'imports.view',
  request: { query: listReviewsSchema.query },
  response: pagedEnvelope(ReviewDto),
});
documentEndpoint({
  method: 'get',
  path: '/lms-integration-reviews/:id',
  tag: reviewTag,
  summary: 'One LMS create held for review',
  permission: 'imports.view',
  request: { params: reviewIdSchema.params },
  response: envelope(ReviewDto),
  errors: [404],
});
documentEndpoint({
  method: 'post',
  path: '/lms-integration-reviews/:id/decide',
  tag: reviewTag,
  summary: 'Decide: same person, different person, or hold (the import’s workflow)',
  description:
    'SAME_PERSON links to the matched student; DIFFERENT_PERSON creates the student (code LMS-…) with the review id; HOLD keeps it pending. A decided review cannot be decided again.',
  permission: 'imports.update',
  request: { params: decideReviewSchema.params, body: decideReviewSchema.body },
  response: envelope(ReviewDto),
  status: 200,
  errors: [404, 409],
});
