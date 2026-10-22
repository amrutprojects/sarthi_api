import type { ListQuery } from '../../shared/utils/pagination';
import type { CourseStatus } from './course.constants';

/* Columns a client may sort by (?sortBy=). */
export type LmsCourseSortField = 'code' | 'title' | 'status' | 'createdAt' | 'updatedAt';

/* L-06 "Search course code or title; filter status, entity". */
export interface LmsCourseListQuery extends ListQuery<LmsCourseSortField> {
  status?: CourseStatus;
  entityId?: string;
  /* true: ONLY soft-deleted courses (the "Show deleted" list); otherwise only the non-deleted ones. */
  deleted?: boolean;
}

/* The owner entity as shown next to a course (UI-315 "entity"). */
export interface CourseEntitySummary {
  id: string;
  name: string;
  code: string;
}

/* One programme module of the course, as summarised on the course detail (UI-316). */
export interface CourseModuleSummary {
  id: string;
  moduleNumber: number;
  title: string;
  coreHours: number | null;
  oftHoursMin: number | null;
  oftHoursMax: number | null;
  syllabusRef: string | null;
  status: string;
  isActive: boolean;
}

/* One kind of record that points at the course, with how many non-deleted rows do. */
export interface LmsCourseReference {
  label: string;
  count: number;
}

/* API shape of a course (list rows and detail). */
export interface PublicLmsCourse {
  id: string;
  entityId: string;
  entity: CourseEntitySummary | null;
  code: string;
  title: string;
  description: string | null;
  languages: string[];
  status: CourseStatus;
  publishedReleaseId: string | null;
  publishedReleaseNo: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/*
 * Detail only: the modules (1 to 4) and what still references the course.
 * L-06 acceptance: "A course cannot be included in a release unless it has modules 1 to 4" — hasAllModules.
 */
export interface PublicLmsCourseDetail extends PublicLmsCourse {
  modules: CourseModuleSummary[];
  missingModuleNumbers: number[];
  hasAllModules: boolean;
  references: LmsCourseReference[];
}

export interface LmsCourseOption {
  id: string;
  code: string;
  title: string;
  entityId: string;
}

/* GET /lms/courses/languages?entityId=: the entity's enabled languages (F-LMS-06-05), in platform order. */
export interface LmsCourseLanguageOptions {
  defaultLanguage: string;
  languages: { code: string; label: string }[];
}

export interface CreateLmsCourseInput {
  entityId: string;
  code: string;
  title: string;
  description?: string | null;
  languages?: string[];
  isActive?: boolean;
}

/* undefined = not sent (left alone); null = cleared. The entity is immutable after creation (F-LMS-06-03). */
export interface UpdateLmsCourseInput {
  code?: string;
  title?: string;
  description?: string | null;
  languages?: string[];
}
