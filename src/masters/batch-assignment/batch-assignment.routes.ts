import { Router } from 'express';
import { P } from '../../modules/roles-permissions';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { batchAssignmentController } from './batch-assignment.controller';
import {
  batchAssignmentIdSchema, batchAssignmentStatusSchema, createBatchAssignmentSchema, listBatchAssignmentsSchema,
  studentOptionsSchema, updateBatchAssignmentSchema,
} from './batch-assignment.validator';

/* /api/v1/cms/batch-assignments — Assign Batch. See state.routes.ts for the shared conventions. */
export const batchAssignmentRouter = Router();

batchAssignmentRouter.get(
  '/',
  authorizePermission(P.CMS_BATCH_ASSIGNMENTS_VIEW),
  validateRequest(listBatchAssignmentsSchema),
  batchAssignmentController.list,
);
/*
 * Student search feed of the Assign Batch form (min 2 characters, max 20 rows, no personal fields).
 * Only for users who can create or edit assignments. Registered before /:id.
 */
batchAssignmentRouter.get(
  '/student-options',
  authorizePermission([P.CMS_BATCH_ASSIGNMENTS_CREATE, P.CMS_BATCH_ASSIGNMENTS_UPDATE], { any: true }),
  validateRequest(studentOptionsSchema),
  batchAssignmentController.studentOptions,
);
batchAssignmentRouter.post(
  '/',
  authorizePermission(P.CMS_BATCH_ASSIGNMENTS_CREATE),
  validateRequest(createBatchAssignmentSchema),
  batchAssignmentController.create,
);
batchAssignmentRouter.get(
  '/:id',
  authorizePermission(P.CMS_BATCH_ASSIGNMENTS_VIEW),
  validateRequest(batchAssignmentIdSchema),
  batchAssignmentController.get,
);
batchAssignmentRouter.put(
  '/:id',
  authorizePermission(P.CMS_BATCH_ASSIGNMENTS_UPDATE),
  validateRequest(updateBatchAssignmentSchema),
  batchAssignmentController.update,
);
batchAssignmentRouter.patch(
  '/:id',
  authorizePermission(P.CMS_BATCH_ASSIGNMENTS_UPDATE),
  validateRequest(updateBatchAssignmentSchema),
  batchAssignmentController.update,
);
batchAssignmentRouter.patch(
  '/:id/status',
  authorizePermission(P.CMS_BATCH_ASSIGNMENTS_UPDATE),
  validateRequest(batchAssignmentStatusSchema),
  batchAssignmentController.setStatus,
);
batchAssignmentRouter.delete(
  '/:id',
  authorizePermission(P.CMS_BATCH_ASSIGNMENTS_DELETE),
  validateRequest(batchAssignmentIdSchema),
  batchAssignmentController.remove,
);
batchAssignmentRouter.post(
  '/:id/restore',
  authorizePermission(P.CMS_BATCH_ASSIGNMENTS_DELETE),
  validateRequest(batchAssignmentIdSchema),
  batchAssignmentController.restore,
);
