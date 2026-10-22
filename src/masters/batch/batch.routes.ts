import { Router } from 'express';
import { P } from '../../modules/roles-permissions';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { batchController } from './batch.controller';
import {
  batchIdSchema, batchOptionsSchema, batchStatusSchema, createBatchSchema, listBatchesSchema, updateBatchSchema,
} from './batch.validator';

/* /api/v1/cms/batches — Batch Master. See state.routes.ts for the shared conventions. */
export const batchRouter = Router();

batchRouter.get('/', authorizePermission(P.CMS_BATCHES_VIEW), validateRequest(listBatchesSchema), batchController.list);
/*
 * Dropdown feed (active only; ?assignable=true for the Assign Batch form). Readable by Assign Batch users
 * too. Registered before /:id so "options" is never read as an id.
 */
batchRouter.get(
  '/options',
  authorizePermission([P.CMS_BATCHES_VIEW, P.CMS_BATCH_ASSIGNMENTS_VIEW], { any: true }),
  validateRequest(batchOptionsSchema),
  batchController.options,
);
batchRouter.post('/', authorizePermission(P.CMS_BATCHES_CREATE), validateRequest(createBatchSchema), batchController.create);
batchRouter.get('/:id', authorizePermission(P.CMS_BATCHES_VIEW), validateRequest(batchIdSchema), batchController.get);
batchRouter.put('/:id', authorizePermission(P.CMS_BATCHES_UPDATE), validateRequest(updateBatchSchema), batchController.update);
batchRouter.patch('/:id', authorizePermission(P.CMS_BATCHES_UPDATE), validateRequest(updateBatchSchema), batchController.update);
batchRouter.patch('/:id/status', authorizePermission(P.CMS_BATCHES_UPDATE), validateRequest(batchStatusSchema), batchController.setStatus);
batchRouter.delete('/:id', authorizePermission(P.CMS_BATCHES_DELETE), validateRequest(batchIdSchema), batchController.remove);
batchRouter.post('/:id/restore', authorizePermission(P.CMS_BATCHES_DELETE), validateRequest(batchIdSchema), batchController.restore);
