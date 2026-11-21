import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.middleware';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { lmsSyncController } from './lms-sync.controller';
import { listSyncSchema, pushSchema, retrySchema, syncStudentSchema } from './lms-sync.validation';

/*
 * Amrut → LMS student sync, admin side (/api/v1/lms-sync; docs/lms-sync/admin-api.md). Permissions follow the
 * student register: reading needs imports.view or candidates.view; queuing, retrying and running need imports.update.
 */
export const lmsSyncRouter = Router();
lmsSyncRouter.use(authenticate);

const view = authorizePermission(['imports.view', 'candidates.view'], { any: true });
const act = authorizePermission('imports.update');

lmsSyncRouter.get('/summary', view, lmsSyncController.summary);
lmsSyncRouter.get('/students', view, validateRequest(listSyncSchema), lmsSyncController.list);
/* Registered before '/students/:id' so the action names are never read as ids. */
lmsSyncRouter.post('/students/push', act, validateRequest(pushSchema), lmsSyncController.push);
lmsSyncRouter.post('/students/retry', act, validateRequest(retrySchema), lmsSyncController.retry);
lmsSyncRouter.get('/students/:id', view, validateRequest(syncStudentSchema), lmsSyncController.detail);
lmsSyncRouter.post('/run', act, lmsSyncController.run);
