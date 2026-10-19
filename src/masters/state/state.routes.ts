import { Router } from 'express';
import { P } from '../../constants/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { parentIdParams } from '../../validators/common.validator';
import { stateController } from './state.controller';
import { createStateSchema, listStatesSchema, stateIdSchema, stateStatusSchema, updateStateSchema } from './state.validator';

/*
 * /api/v1/cms/states — State Master.
 *
 * authenticate() is applied once by the parent masters router. Every route below is additionally
 * guarded by its own permission, so a signed-in user without the CMS codes gets 403 (and the denial is
 * written to the audit log by authorizePermission).
 *
 * PUT and PATCH both map to update: PATCH is this codebase convention, PUT is kept because the CMS API
 * contract documents it.
 */
export const stateRouter = Router();

stateRouter.get('/', authorizePermission(P.CMS_STATES_VIEW), validateRequest(listStatesSchema), stateController.list);
stateRouter.post('/', authorizePermission(P.CMS_STATES_CREATE), validateRequest(createStateSchema), stateController.create);
stateRouter.get('/:id', authorizePermission(P.CMS_STATES_VIEW), validateRequest(stateIdSchema), stateController.get);
stateRouter.put('/:id', authorizePermission(P.CMS_STATES_UPDATE), validateRequest(updateStateSchema), stateController.update);
stateRouter.patch('/:id', authorizePermission(P.CMS_STATES_UPDATE), validateRequest(updateStateSchema), stateController.update);
stateRouter.patch('/:id/status', authorizePermission(P.CMS_STATES_UPDATE), validateRequest(stateStatusSchema), stateController.setStatus);
stateRouter.delete('/:id', authorizePermission(P.CMS_STATES_DELETE), validateRequest(stateIdSchema), stateController.remove);
stateRouter.post('/:id/restore', authorizePermission(P.CMS_STATES_DELETE), validateRequest(stateIdSchema), stateController.restore);

/* Nested dropdown feed. Readable by whoever may view either of the two child masters. */
stateRouter.get(
  '/:stateId/districts',
  authorizePermission([P.CMS_DISTRICTS_VIEW, P.CMS_TALUKAS_VIEW], { any: true }),
  validateRequest({ params: parentIdParams('stateId') }),
  stateController.districts,
);
