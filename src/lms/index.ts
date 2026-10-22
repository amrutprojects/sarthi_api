import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.middleware';
import { referenceRouter } from './reference/reference.routes';
import { lmsEntityRouter } from './entity/entity.routes';
import { lmsBrandingRouter } from './branding/branding.routes';
import { lmsCourseRouter } from './course/course.routes';
import { lmsCourseModuleRouter } from './course-module/course-module.routes';
import { lmsCalendarRouter } from './calendar/calendar.routes';
import { lmsFormFieldRouter } from './form-field/form-field.routes';
import { lmsTrackVariantRouter } from './track-variant/track-variant.routes';

/*
 * /api/v1/lms — the LMS Admin masters (AMRUT_KALASH_03 LMS Admin specification).
 *
 * authenticate() runs once here; every route then declares its own permission (lms-<menu>.<action>).
 * Reference data owned by the Admin Panel (districts, training centres, technology tracks) is read here,
 * never written: the LMS Admin and the Admin Panel share this database, so no copy is kept.
 */
export const lmsRouter = Router();

lmsRouter.use(authenticate);

/* Masters are mounted below in dependency order as they are built. */
lmsRouter.use('/reference', referenceRouter);
lmsRouter.use('/entities', lmsEntityRouter);
lmsRouter.use('/branding', lmsBrandingRouter);
lmsRouter.use('/calendars', lmsCalendarRouter);
lmsRouter.use('/form-fields', lmsFormFieldRouter);
lmsRouter.use('/courses', lmsCourseRouter);
lmsRouter.use('/course-modules', lmsCourseModuleRouter);
lmsRouter.use('/track-variants', lmsTrackVariantRouter);
