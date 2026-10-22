import { Router } from 'express';
import { P } from '../../modules/roles-permissions';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { lmsCourseModuleController } from './course-module.controller';
import {
  createLmsCourseModuleSchema, createPrescribedModulesSchema, listLmsCourseModulesSchema, lmsCourseModuleIdSchema,
  lmsCourseModuleOptionsSchema, lmsCourseModuleStatusSchema, updateLmsCourseModuleSchema,
} from './course-module.validator';

/*
 * /api/v1/lms/course-modules — Module Master (AMRUT_KALASH_03 L-06 / FR-306, F-LMS-07; API-204 "/modules").
 * Spec permission → code: curriculum.view → lms-course-modules.view · curriculum.create →
 * lms-course-modules.create · curriculum.update → lms-course-modules.update · curriculum.archive →
 * lms-course-modules.delete.
 */
export const lmsCourseModuleRouter = Router();

lmsCourseModuleRouter.get('/', authorizePermission(P.LMS_COURSE_MODULES_VIEW), validateRequest(listLmsCourseModulesSchema), lmsCourseModuleController.list);
/* Dropdown feed (?courseId=&moduleNumber=) for the Track Variant master. Fixed paths before /:id. */
lmsCourseModuleRouter.get(
  '/options',
  authorizePermission([P.LMS_COURSE_MODULES_VIEW, P.LMS_TRACK_VARIANTS_VIEW], { any: true }),
  validateRequest(lmsCourseModuleOptionsSchema),
  lmsCourseModuleController.options,
);
/* The four prescribed modules of the final syllabus documents (section 2.1; defaults the editor offers). */
lmsCourseModuleRouter.get(
  '/prescribed',
  authorizePermission([P.LMS_COURSE_MODULES_VIEW, P.LMS_COURSE_MODULES_CREATE, P.LMS_COURSE_MODULES_UPDATE], { any: true }),
  lmsCourseModuleController.prescribed,
);
lmsCourseModuleRouter.post(
  '/prescribed',
  authorizePermission(P.LMS_COURSE_MODULES_CREATE),
  validateRequest(createPrescribedModulesSchema),
  lmsCourseModuleController.createPrescribed,
);
lmsCourseModuleRouter.post('/', authorizePermission(P.LMS_COURSE_MODULES_CREATE), validateRequest(createLmsCourseModuleSchema), lmsCourseModuleController.create);
lmsCourseModuleRouter.get('/:id', authorizePermission(P.LMS_COURSE_MODULES_VIEW), validateRequest(lmsCourseModuleIdSchema), lmsCourseModuleController.get);
lmsCourseModuleRouter.put('/:id', authorizePermission(P.LMS_COURSE_MODULES_UPDATE), validateRequest(updateLmsCourseModuleSchema), lmsCourseModuleController.update);
lmsCourseModuleRouter.patch('/:id', authorizePermission(P.LMS_COURSE_MODULES_UPDATE), validateRequest(updateLmsCourseModuleSchema), lmsCourseModuleController.update);
lmsCourseModuleRouter.patch(
  '/:id/status',
  authorizePermission(P.LMS_COURSE_MODULES_UPDATE),
  validateRequest(lmsCourseModuleStatusSchema),
  lmsCourseModuleController.setStatus,
);
lmsCourseModuleRouter.delete('/:id', authorizePermission(P.LMS_COURSE_MODULES_DELETE), validateRequest(lmsCourseModuleIdSchema), lmsCourseModuleController.remove);
lmsCourseModuleRouter.post(
  '/:id/restore',
  authorizePermission(P.LMS_COURSE_MODULES_DELETE),
  validateRequest(lmsCourseModuleIdSchema),
  lmsCourseModuleController.restore,
);
