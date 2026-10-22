/*
 * The models of the LMS Admin masters, picked up by src/database/entities.ts.
 *
 * Deliberately a leaf module (models only, never a router or middleware), for the same reason as
 * src/masters/masters.entities.ts: the entity registry is loaded while the DataSource is built.
 * Each master appends its model classes here as it is added.
 */
import { LmsEntityCentre } from './entity/entity-centre.model';
import { LmsEntityTrack } from './entity/entity-track.model';
import { LmsEntity } from './entity/entity.model';
import { LmsEntitySetting } from './branding/branding.model';
import { LmsCourse } from './course/course.model';
import { LmsCourseModule } from './course-module/course-module.model';
import { LmsAcademicCalendar } from './calendar/calendar.model';
import { LmsCalendarHoliday } from './calendar/calendar-holiday.model';
import { LmsLearningConfig } from './calendar/learning-config.model';
import { LmsFormField } from './form-field/form-field.model';
import { LmsTrackVariant } from './track-variant/track-variant.model';
import { LmsTrackVariantPhase } from './track-variant/track-variant-phase.model';
import { LmsTrackVariantModule } from './track-variant/track-variant-module.model';
import { LmsTrackVariantComponent } from './track-variant/track-variant-component.model';
import { LmsTrackVariantOftCard } from './track-variant/track-variant-oft-card.model';
import { LmsTrackVariantAssessmentComponent } from './track-variant/track-variant-assessment-component.model';
import { LmsTrackVariantReadinessGate } from './track-variant/track-variant-gate.model';

export const LMS_ENTITIES: (new () => object)[] = [
  LmsEntity, LmsEntityCentre, LmsEntityTrack, LmsEntitySetting, LmsCourse, LmsCourseModule, LmsAcademicCalendar, LmsCalendarHoliday, LmsLearningConfig,
  LmsFormField,
  LmsTrackVariant, LmsTrackVariantPhase, LmsTrackVariantModule, LmsTrackVariantComponent, LmsTrackVariantOftCard,
  LmsTrackVariantAssessmentComponent, LmsTrackVariantReadinessGate,
];
