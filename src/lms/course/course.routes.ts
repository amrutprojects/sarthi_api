import { Router } from 'express';
import { P } from '../../modules/roles-permissions';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { lmsCourseController } from './course.controller';
import {
  createLmsCourseSchema, listLmsCoursesSchema, lmsCourseIdSchema, lmsCourseLanguagesSchema, lmsCourseOptionsSchema, lmsCourseStatusSchema,
  updateLmsCourseSchema,
} from './course.validator';

/*
 * /api/v1/lms/courses — Course Master (AMRUT_KALASH_03 L-06 / FR-306, F-LMS-06; API-204 "/courses").
 * Spec permission → code: curriculum.view → lms-courses.view · curriculum.create → lms-courses.create ·
 * curriculum.update → lms-courses.update · curriculum.archive (delete, retire) → lms-courses.delete.
 */
export const lmsCourseRouter = Router();

lmsCourseRouter.get('/', authorizePermission(P.LMS_COURSES_VIEW), validateRequest(listLmsCoursesSchema), lmsCourseController.list);
/* Dropdown feed (active, not retired; ?entityId=) for the Module and Track Variant masters. Before /:id. */
lmsCourseRouter.get(
  '/options',
  authorizePermission([P.LMS_COURSES_VIEW, P.LMS_COURSE_MODULES_VIEW, P.LMS_TRACK_VARIANTS_VIEW], { any: true }),
  validateRequest(lmsCourseOptionsSchema),
  lmsCourseController.options,
);
/* The course form's language list: the entity's enabled languages (F-LMS-06-05). Before /:id. */
lmsCourseRouter.get(
  '/languages',
  authorizePermission([P.LMS_COURSES_VIEW, P.LMS_COURSES_CREATE, P.LMS_COURSES_UPDATE], { any: true }),
  validateRequest(lmsCourseLanguagesSchema),
  lmsCourseController.languages,
);
lmsCourseRouter.post('/', authorizePermission(P.LMS_COURSES_CREATE), validateRequest(createLmsCourseSchema), lmsCourseController.create);
lmsCourseRouter.get('/:id', authorizePermission(P.LMS_COURSES_VIEW), validateRequest(lmsCourseIdSchema), lmsCourseController.get);
lmsCourseRouter.put('/:id', authorizePermission(P.LMS_COURSES_UPDATE), validateRequest(updateLmsCourseSchema), lmsCourseController.update);
lmsCourseRouter.patch('/:id', authorizePermission(P.LMS_COURSES_UPDATE), validateRequest(updateLmsCourseSchema), lmsCourseController.update);
lmsCourseRouter.patch('/:id/status', authorizePermission(P.LMS_COURSES_UPDATE), validateRequest(lmsCourseStatusSchema), lmsCourseController.setStatus);
/* F-LMS-06-06 Retire action (curriculum.archive). */
lmsCourseRouter.post('/:id/retire', authorizePermission(P.LMS_COURSES_DELETE), validateRequest(lmsCourseIdSchema), lmsCourseController.retire);
lmsCourseRouter.delete('/:id', authorizePermission(P.LMS_COURSES_DELETE), validateRequest(lmsCourseIdSchema), lmsCourseController.remove);
lmsCourseRouter.post('/:id/restore', authorizePermission(P.LMS_COURSES_DELETE), validateRequest(lmsCourseIdSchema), lmsCourseController.restore);
