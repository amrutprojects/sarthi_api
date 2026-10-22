import { Router } from 'express';
import { P } from '../../modules/roles-permissions';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { lmsEntityController } from './entity.controller';
import {
  createLmsEntitySchema, listLmsEntitiesSchema, lmsEntityIdSchema, lmsEntityStatusSchema, updateLmsEntitySchema,
} from './entity.validator';

/*
 * /api/v1/lms/entities — Entity Master (AMRUT_KALASH_03 L-03, F-LMS-03; API-202 "entities").
 * Same conventions as the CMS masters (state.routes.ts). Spec permission → code:
 * entity.view → lms-entities.view · entity.create → lms-entities.create · entity.update →
 * lms-entities.update · entity.archive → lms-entities.delete.
 */
export const lmsEntityRouter = Router();

lmsEntityRouter.get('/', authorizePermission(P.LMS_ENTITIES_VIEW), validateRequest(listLmsEntitiesSchema), lmsEntityController.list);
/*
 * Contract E1: dropdown feed (active entities, A to Z) for every LMS master that picks an entity.
 * Registered before /:id so "options" is never read as an id.
 */
lmsEntityRouter.get(
  '/options',
  authorizePermission(
    [
      P.LMS_ENTITIES_VIEW,
      P.LMS_BRANDING_VIEW,
      P.LMS_CALENDARS_VIEW,
      P.LMS_LEARNING_CONFIG_VIEW,
      P.LMS_FORM_FIELDS_VIEW,
      P.LMS_COURSES_VIEW,
      P.LMS_COURSE_MODULES_VIEW,
      P.LMS_TRACK_VARIANTS_VIEW,
    ],
    { any: true },
  ),
  lmsEntityController.options,
);
/* The platform language list (To Be Confirmed, OQ-023) and the time zones the entity form offers. */
lmsEntityRouter.get(
  '/form-options',
  authorizePermission(
    [
      P.LMS_ENTITIES_VIEW,
      P.LMS_ENTITIES_CREATE,
      P.LMS_ENTITIES_UPDATE,
      P.LMS_BRANDING_VIEW,
      P.LMS_BRANDING_UPDATE,
      P.LMS_BRANDING_UPDATE_SETTINGS,
    ],
    { any: true },
  ),
  lmsEntityController.formOptions,
);
lmsEntityRouter.post('/', authorizePermission(P.LMS_ENTITIES_CREATE), validateRequest(createLmsEntitySchema), lmsEntityController.create);
lmsEntityRouter.get('/:id', authorizePermission(P.LMS_ENTITIES_VIEW), validateRequest(lmsEntityIdSchema), lmsEntityController.get);
lmsEntityRouter.put('/:id', authorizePermission(P.LMS_ENTITIES_UPDATE), validateRequest(updateLmsEntitySchema), lmsEntityController.update);
lmsEntityRouter.patch('/:id', authorizePermission(P.LMS_ENTITIES_UPDATE), validateRequest(updateLmsEntitySchema), lmsEntityController.update);
lmsEntityRouter.patch(
  '/:id/status',
  authorizePermission(P.LMS_ENTITIES_UPDATE),
  validateRequest(lmsEntityStatusSchema),
  lmsEntityController.setStatus,
);
lmsEntityRouter.delete('/:id', authorizePermission(P.LMS_ENTITIES_DELETE), validateRequest(lmsEntityIdSchema), lmsEntityController.remove);
lmsEntityRouter.post(
  '/:id/restore',
  authorizePermission(P.LMS_ENTITIES_DELETE),
  validateRequest(lmsEntityIdSchema),
  lmsEntityController.restore,
);
