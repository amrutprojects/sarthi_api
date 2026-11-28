import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.middleware';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { idempotent } from '../../shared/idempotency/idempotency.middleware';
import { P } from '../roles-permissions';
import { DECIDE_PERMISSIONS } from './ipp-approvals.constants';
import { ippApprovalsController as c } from './ipp-approvals.controller';
import {
  approveBatchSchema,
  approveManySchema,
  approveSchema,
  documentSchema,
  headOfficeSchema,
  idSchema,
  listApplicationsSchema,
  listBatchesSchema,
  officerDistrictsSchema,
  rejectSchema,
  retrySchema,
} from './ipp-approvals.validation';

/*
 * /api/v1/ipp-approvals — approval of the student forms of IPP (docs/ipp-approvals.md). The permission opens the door;
 * which forms a user sees and decides comes from ipp-access.ts, in the SQL of every query.
 */
export const ippApprovalsRouter = Router();
ippApprovalsRouter.use(authenticate);
/* Personal data in almost every answer: never kept by a cache. */
ippApprovalsRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});

const view = authorizePermission(P.IPP_APPROVALS_VIEW);
const decide = authorizePermission([...DECIDE_PERMISSIONS], { any: true });
const settingsView = authorizePermission('settings.view');
const settingsUpdate = authorizePermission('settings.update');

ippApprovalsRouter.get('/summary', view, c.summary);
ippApprovalsRouter.get('/dashboard', view, c.dashboard);
ippApprovalsRouter.get('/applications', view, validateRequest(listApplicationsSchema), c.listApplications);
ippApprovalsRouter.get('/applications/:id', view, validateRequest(idSchema), c.application);
ippApprovalsRouter.get('/applications/:id/documents/:code', view, validateRequest(documentSchema), c.document);
ippApprovalsRouter.get('/batches', view, validateRequest(listBatchesSchema), c.listBatches);
ippApprovalsRouter.get('/batches/:id', view, validateRequest(idSchema), c.batch);
/* Also for the officers' page, whose users need not see the forms. */
ippApprovalsRouter.get('/districts', authorizePermission([P.IPP_APPROVALS_VIEW, P.IPP_OFFICERS_VIEW], { any: true }), c.districts);

/*
 * Idempotency-Key on the two that decide many: their answers hold ids only. A single decision answers with the whole form
 * (not to be kept in idempotency_keys) and cannot be made twice anyway: the second one finds another stage.
 */
ippApprovalsRouter.post('/approve', decide, validateRequest(approveManySchema), idempotent, c.approveMany);
ippApprovalsRouter.post('/batches/:id/approve', decide, validateRequest(approveBatchSchema), idempotent, c.approveBatch);
ippApprovalsRouter.post('/applications/:id/approve', decide, validateRequest(approveSchema), c.approve);
ippApprovalsRouter.post('/applications/:id/reject', decide, validateRequest(rejectSchema), c.reject);

ippApprovalsRouter.get('/head-office', authorizePermission([P.IPP_APPROVALS_VIEW, 'settings.view'], { any: true }), c.headOffice);
ippApprovalsRouter.put('/head-office', settingsUpdate, validateRequest(headOfficeSchema), c.setHeadOffice);

ippApprovalsRouter.get('/officers', authorizePermission(P.IPP_OFFICERS_VIEW), c.officers);
ippApprovalsRouter.put(
  '/officers/:userId/districts',
  authorizePermission(P.IPP_OFFICERS_UPDATE),
  validateRequest(officerDistrictsSchema),
  c.setOfficerDistricts,
);

ippApprovalsRouter.get('/link', settingsView, c.link);
ippApprovalsRouter.post('/link/retry', settingsUpdate, validateRequest(retrySchema), c.retryLink);
ippApprovalsRouter.post('/link/test', settingsUpdate, c.testLink);
