import { Router } from 'express';
import { P } from '../../modules/roles-permissions';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { lmsCalendarController } from './calendar.controller';
import {
  createLmsCalendarSchema, learningConfigQuerySchema, listLmsCalendarsSchema, lmsCalendarIdSchema, lmsCalendarOptionsSchema,
  lmsCalendarStatusSchema, updateLearningConfigSchema, updateLmsCalendarSchema,
} from './calendar.validator';

/*
 * /api/v1/lms/calendars — Academic calendar and learning configuration (AMRUT_KALASH_03 L-05 / FR-305,
 * F-LMS-05; API-203 "calendars · learning-config"). Same conventions as the Entity Master. Spec permission →
 * code: calendar.view → lms-calendars.view · calendar.create → lms-calendars.create · calendar.update →
 * lms-calendars.update · archive → lms-calendars.delete · config.learning.view / update →
 * lms-learning-config.view / update (L-05 role permissions; its own Learning Configuration menu, so the
 * calendar codes alone do not open the learning configuration, nor its codes the calendars).
 */
export const lmsCalendarRouter = Router();

lmsCalendarRouter.get('/', authorizePermission(P.LMS_CALENDARS_VIEW), validateRequest(listLmsCalendarsSchema), lmsCalendarController.list);
/* Fixed paths are registered before /:id so they are never read as an id. */
lmsCalendarRouter.get(
  '/options',
  authorizePermission(P.LMS_CALENDARS_VIEW),
  validateRequest(lmsCalendarOptionsSchema),
  lmsCalendarController.options,
);
lmsCalendarRouter.get(
  '/form-options',
  authorizePermission([P.LMS_CALENDARS_VIEW, P.LMS_CALENDARS_CREATE, P.LMS_CALENDARS_UPDATE], { any: true }),
  lmsCalendarController.formOptions,
);
lmsCalendarRouter.get(
  '/learning-config',
  authorizePermission(P.LMS_LEARNING_CONFIG_VIEW),
  validateRequest(learningConfigQuerySchema),
  lmsCalendarController.learningConfig,
);
lmsCalendarRouter.put(
  '/learning-config/:key',
  authorizePermission(P.LMS_LEARNING_CONFIG_UPDATE),
  validateRequest(updateLearningConfigSchema),
  lmsCalendarController.updateLearningConfig,
);
lmsCalendarRouter.patch(
  '/learning-config/:key',
  authorizePermission(P.LMS_LEARNING_CONFIG_UPDATE),
  validateRequest(updateLearningConfigSchema),
  lmsCalendarController.updateLearningConfig,
);
lmsCalendarRouter.post('/', authorizePermission(P.LMS_CALENDARS_CREATE), validateRequest(createLmsCalendarSchema), lmsCalendarController.create);
lmsCalendarRouter.get('/:id', authorizePermission(P.LMS_CALENDARS_VIEW), validateRequest(lmsCalendarIdSchema), lmsCalendarController.get);
lmsCalendarRouter.put('/:id', authorizePermission(P.LMS_CALENDARS_UPDATE), validateRequest(updateLmsCalendarSchema), lmsCalendarController.update);
lmsCalendarRouter.patch('/:id', authorizePermission(P.LMS_CALENDARS_UPDATE), validateRequest(updateLmsCalendarSchema), lmsCalendarController.update);
lmsCalendarRouter.patch(
  '/:id/status',
  authorizePermission(P.LMS_CALENDARS_UPDATE),
  validateRequest(lmsCalendarStatusSchema),
  lmsCalendarController.setStatus,
);
lmsCalendarRouter.delete('/:id', authorizePermission(P.LMS_CALENDARS_DELETE), validateRequest(lmsCalendarIdSchema), lmsCalendarController.remove);
lmsCalendarRouter.post(
  '/:id/restore',
  authorizePermission(P.LMS_CALENDARS_DELETE),
  validateRequest(lmsCalendarIdSchema),
  lmsCalendarController.restore,
);
