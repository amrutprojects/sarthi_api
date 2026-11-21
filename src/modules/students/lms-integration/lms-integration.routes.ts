import { Router } from 'express';
import { MESSAGES } from '../../../constants/api-response.constants';
import { authenticate } from '../../../middleware/authenticate.middleware';
import { authorizePermission } from '../../../middleware/authorize-permission.middleware';
import { body, query, validateRequest } from '../../../middleware/validate-request.middleware';
import { asyncHandler } from '../../../shared/http/async-handler';
import { ApiResponse } from '../../../utils/api-response';
import { requireApiKey } from '../../api-keys';
import { lmsErrorHandler } from './lms-api-error';
import { lmsReviewService } from './lms-review.service';
import { lmsStudentService } from './lms-student.service';
import {
  decideReviewSchema,
  listReviewsSchema,
  reviewIdSchema,
  type DecideReviewBody,
  type ListReviewsQuery,
} from './lms-integration.validation';

/*
 * /api/v1/lms-integration — called by the LMS server with an Amrut-issued key in X-Api-Key (contract
 * amrut-student-api.md §2–§4). No session. Answers are the contract's bodies (no envelope on success); errors carry
 * `{field, code}` pairs only. Request bodies are validated in the service so a refusal is a 400 with those pairs.
 */
export const lmsIntegrationStudentRouter = Router();

lmsIntegrationStudentRouter.post(
  '/students/match',
  requireApiKey('lms.students.match'),
  asyncHandler(async (req, res) => {
    res.status(200).json(await lmsStudentService.match(req.body));
  }),
);
lmsIntegrationStudentRouter.post(
  '/students',
  requireApiKey('lms.students.create'),
  asyncHandler(async (req, res) => {
    const answer = await lmsStudentService.create(req.body, req.header('idempotency-key'), req.apiKey?.id ?? null, req);
    res.status(answer.status).json(answer.body);
  }),
);
lmsIntegrationStudentRouter.patch(
  '/students/:studentId',
  requireApiKey('lms.students.update'),
  asyncHandler(async (req, res) => {
    res.status(200).json(await lmsStudentService.update(String(req.params.studentId), req.body, req.apiKey?.id ?? null, req));
  }),
);
lmsIntegrationStudentRouter.use(lmsErrorHandler);

/*
 * /api/v1/lms-integration-reviews — Amrut staff decide the LMS creates held for review, with the same permissions as
 * the import's same-person / different-person decisions: imports.view (read) · imports.update (decide).
 */
export const lmsReviewRouter = Router();
lmsReviewRouter.use(authenticate);

lmsReviewRouter.get(
  '/',
  authorizePermission('imports.view'),
  validateRequest(listReviewsSchema),
  asyncHandler(async (req, res) => {
    const q = query<ListReviewsQuery>(req);
    const { items, total } = await lmsReviewService.list(q);
    ApiResponse.ok(res, items, MESSAGES.retrieved('LMS reviews'), {
      page: q.page,
      limit: q.limit,
      total,
      totalPages: Math.ceil(total / q.limit),
    });
  }),
);
lmsReviewRouter.get(
  '/:id',
  authorizePermission('imports.view'),
  validateRequest(reviewIdSchema),
  asyncHandler(async (req, res) => {
    ApiResponse.ok(res, await lmsReviewService.get(String(req.params.id)), MESSAGES.retrieved('LMS review'));
  }),
);
lmsReviewRouter.post(
  '/:id/decide',
  authorizePermission('imports.update'),
  validateRequest(decideReviewSchema),
  asyncHandler(async (req, res) => {
    const b = body<DecideReviewBody>(req);
    ApiResponse.ok(res, await lmsReviewService.decide(String(req.params.id), b.decision, b.reason, req.auth!, req), 'Decision recorded');
  }),
);
