import type { ListQuery } from '../../shared/utils/pagination';
import type { ModuleStatus, PrescribedModule } from './course-module.constants';

/* Columns a client may sort by (?sortBy=). */
export type LmsCourseModuleSortField = 'moduleNumber' | 'title' | 'createdAt' | 'updatedAt';

export interface LmsCourseModuleListQuery extends ListQuery<LmsCourseModuleSortField> {
  courseId?: string;
  moduleNumber?: number;
  status?: ModuleStatus;
  /* true: ONLY soft-deleted modules (the "Show deleted" list); otherwise only the non-deleted ones. */
  deleted?: boolean;
}

/* The course as shown next to a module. */
export interface ModuleCourseSummary {
  id: string;
  code: string;
  title: string;
  entityId: string;
}

/* The values F-LMS-07 stores, as one record (also the shape the consistency check reads). */
export interface ModuleHours {
  coreHours: number | null;
  syllabusRef: string | null;
  sessions: number | null;
  sessionHours: number | null;
  lectureHours: number | null;
  practicalHours: number | null;
  oftHoursMin: number | null;
  oftHoursMax: number | null;
}

/* API shape of a programme module (list rows and detail). */
export interface PublicLmsCourseModule extends ModuleHours {
  id: string;
  courseId: string;
  course: ModuleCourseSummary | null;
  moduleNumber: number;
  title: string;
  description: string | null;
  status: ModuleStatus;
  /*
   * The F-LMS-07 fields marked "Required before release" (core hours, syllabus reference, delivery pattern,
   * OFT range) that are still empty — the L-30 pre-publication check reads the same list.
   */
  missingForRelease: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  references?: { label: string; count: number }[];
}

export interface LmsCourseModuleOption {
  id: string;
  courseId: string;
  moduleNumber: number;
  title: string;
}

/* GET /lms/course-modules/prescribed. */
export interface PrescribedModulesResponse {
  modules: readonly PrescribedModule[];
  /* false while OQ-012 (approval of the syllabus values by the competent authority) is open. */
  confirmedByCompetentAuthority: boolean;
  source: string;
}

/* POST /lms/course-modules/prescribed. */
export interface PrescribedModulesResult {
  courseId: string;
  created: number[];
  modules: PublicLmsCourseModule[];
}

export interface CreateLmsCourseModuleInput extends Partial<ModuleHours> {
  courseId: string;
  moduleNumber: number;
  title: string;
  description?: string | null;
  isActive?: boolean;
}

/* undefined = not sent (left alone); null = cleared. Course and module number are fixed on creation. */
export interface UpdateLmsCourseModuleInput extends Partial<ModuleHours> {
  title?: string;
  description?: string | null;
  /* F-LMS-07-04: a change of the core hours needs a reason (kept in the audit record). */
  reason?: string;
}
