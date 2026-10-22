import type { ListQuery } from '../../shared/utils/pagination';
import type { CurriculumStatus, EvidenceType, GateClearanceMode, LearningComponentKind } from './track-variant.constants';

/* Columns a client may sort by (?sortBy=). `track` is the Admin Panel's track order (T01…T12). */
export type TrackVariantSortField = 'track' | 'status' | 'createdAt' | 'updatedAt';

export type CompletenessFilter = 'complete' | 'incomplete';

export interface TrackVariantListQuery extends ListQuery<TrackVariantSortField> {
  courseId?: string;
  courseModuleId?: string;
  trackId?: string;
  status?: CurriculumStatus;
  completeness?: CompletenessFilter;
  /* true: ONLY soft-deleted variants (the "Show deleted" list); otherwise only the non-deleted ones. */
  deleted?: boolean;
}

/* Raw per-variant counts behind the completeness check (one row per variant, from SQL). */
export interface TrackVariantCounts {
  phases: number;
  phaseNumbers: number[];
  trackModules: number;
  oftCards: number;
  oftHoursMin: number;
  oftHoursMax: number;
  readinessGates: number;
  gateNumbers: number[];
  assessmentComponents: number;
  weightedComponents: number;
  weightTotal: number;
  trackModuleHours: number;
  hoursEntered: number;
  learningComponents: Record<LearningComponentKind, number>;
}

/* actual vs required; required null = the per-track count (F-LMS-07-09) is not entered yet. */
export interface CountCheck {
  actual: number;
  required: number | null;
}

export interface CompletenessItem {
  item: string;
  message: string;
}

/*
 * The completeness check of a variant (L-07): what is missing against the Module 3 shape. `missing` makes the
 * variant incomplete (it cannot be published / released); `warnings` never block (L-08 hours, L-35 OFT hours).
 */
export interface TrackVariantCompleteness {
  complete: boolean;
  phases: CountCheck;
  trackModules: CountCheck;
  oftCards: CountCheck & { hoursMin: number; hoursMax: number };
  readinessGates: CountCheck;
  assessmentComponents: CountCheck & { weightTotal: number | null };
  learningComponents: Record<LearningComponentKind, number>;
  missing: CompletenessItem[];
  warnings: CompletenessItem[];
}

export interface TrackVariantTrack {
  id: string;
  code: string;
  name: string;
  /* The track's state in the Admin Panel right now (a deactivated track keeps its variant, L-07). */
  isActive: boolean;
}

export interface TrackVariantCourseModule {
  id: string;
  moduleNumber: number;
  title: string;
  coreHours: number | null;
  oftHoursMin: number | null;
  oftHoursMax: number | null;
}

export interface TrackVariantCourse {
  id: string;
  code: string;
  title: string;
  entityId: string;
}

/* API shape of a track variant (list rows and detail). */
export interface PublicTrackVariant {
  id: string;
  courseModuleId: string;
  trackId: string;
  course: TrackVariantCourse;
  courseModule: TrackVariantCourseModule;
  track: TrackVariantTrack;
  status: CurriculumStatus;
  expectedTrackModules: number | null;
  expectedOftCards: number | null;
  syllabusReference: string | null;
  description: string | null;
  publishedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  completeness: TrackVariantCompleteness;
}

export interface CreateTrackVariantInput {
  courseModuleId: string;
  trackId: string;
  expectedTrackModules?: number | null;
  expectedOftCards?: number | null;
  syllabusReference?: string | null;
  description?: string | null;
  isActive?: boolean;
}

/* undefined = not sent (left alone); null = cleared. The module and track are fixed on creation. */
export interface UpdateTrackVariantInput {
  expectedTrackModules?: number | null;
  expectedOftCards?: number | null;
  syllabusReference?: string | null;
  description?: string | null;
}

/* GET /lms/track-variants/form-options: the fixed values the variant screens offer. */
export interface TrackVariantFormOptions {
  shape: {
    phases: number;
    readinessGates: number;
    trackModules: { min: number; max: number };
    oftCards: { min: number; max: number };
    assessmentComponents: number;
  };
  statuses: readonly string[];
  learningComponentKinds: readonly string[];
  singleLearningComponentKinds: readonly string[];
  evidenceTypes: readonly string[];
  clearanceModes: readonly string[];
  competencyBands: { min: number; max: number };
}

/* ---- curriculum items (child rows) ---- */

export interface PhaseInput {
  phaseNumber?: number;
  title?: string;
  description?: string | null;
}

export interface TrackModuleInput {
  phaseId?: string;
  code?: string;
  title?: string;
  sortOrder?: number;
  lectureHours?: number | null;
  practicalHours?: number | null;
  description?: string | null;
}

export interface LearningComponentInput {
  kind?: LearningComponentKind;
  title?: string;
  trackModuleId?: string | null;
  description?: string | null;
}

export interface OftCardInput {
  oftCode?: string;
  title?: string;
  stage?: string | null;
  linkedTrackModuleId?: string | null;
  instructions?: string;
  hoursMin?: number;
  hoursMax?: number;
  deliverable?: string;
  evidenceTypes?: EvidenceType[];
  evidenceNotes?: string | null;
  hostVerificationRequired?: boolean;
}

export interface AssessmentComponentInput {
  componentCode?: string;
  label?: string;
  weight?: number | null;
  source?: string | null;
  indicative?: boolean;
  sortOrder?: number;
}

export interface ReadinessGateInput {
  gateNumber?: number;
  title?: string;
  heldAfterTrackModuleId?: string;
  demonstration?: string;
  evidenceTypes?: EvidenceType[];
  evidenceNotes?: string | null;
  remediationPath?: string;
  clearanceMode?: GateClearanceMode;
  clearanceMinBand?: number | null;
}
