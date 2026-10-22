/*
 * The learning-configuration keys of L-05 (F-LMS-05-07 "Configuration value (per key)"; typed key-value
 * editor on UI-313). Each key is defined once here: type, unit, allowed values, kind and source.
 *
 * Two kinds (L-05 business rules):
 * - SYLLABUS: "seeded with the values of the final syllabus documents and editable". The value below is the
 *   one the spec quotes from those documents (§2.1 Table 7, L-05); it is shown while no value was saved for
 *   the entity, with its source 'final syllabus document, pending approval by the competent authority'
 *   (OQ-012).
 * - PRESCRIBED: "no value until the competent authority prescribes it" — shown as 'To Be Confirmed' until an
 *   authorised user sets it (OQ-013, OQ-014, OQ-015). No default is assumed for any of them.
 *
 * Mode-specific keys (perMode) hold one value for Offline and one for Online (L-05 "Rule sets per delivery
 * mode"); which rules really differ is OQ-042 / OQ-029, so a write without a mode sets both modes alike.
 *
 * Not here, on purpose:
 * - Assessment component weights (indicative defaults, "assessment.weights.updated") are per assessed
 *   component and belong with the assessment structure (L-30 onward), which does not exist in this system.
 * - At-risk rules are rule records (DB-302 at_risk_rule), not single values.
 * Ranges: the spec defines no allowed range per key ("type and range defined per key" is left open), so only
 * the type's own bounds apply (whole numbers ≥ 0 or ≥ 1, percentages 0–100, min ≤ max for a range).
 */

export const LEARNING_CONFIG_MODES = ['OFFLINE', 'ONLINE'] as const;
export type LearningConfigMode = (typeof LEARNING_CONFIG_MODES)[number];

export type LearningConfigType = 'integer' | 'percentage' | 'duration' | 'range' | 'enum' | 'enum-list' | 'labels' | 'text';
export type LearningConfigUnit = 'hours' | 'minutes' | 'days' | 'sessions' | 'attempts' | 'percent';
export type LearningConfigKind = 'SYLLABUS' | 'PRESCRIBED';

export interface RangeValue {
  min: number;
  max: number;
}
export type LearningConfigValue = number | string | string[] | RangeValue;

export interface LearningConfigKeyDef {
  key: string;
  label: string;
  group: string;
  type: LearningConfigType;
  unit?: LearningConfigUnit;
  /* Lower bound of a number / range (the type's own bound, not a business threshold). */
  min?: number;
  options?: readonly string[];
  /* labels: the exact number of labels. */
  length?: number;
  kind: LearningConfigKind;
  perMode: boolean;
  /* SYLLABUS keys only: the value of the final syllabus documents (OQ-012). */
  syllabusValue?: LearningConfigValue;
  openQuestions: readonly string[];
}

export const SYLLABUS_SOURCE = 'Final syllabus document, pending approval by the competent authority';

const syllabus = (
  key: string,
  label: string,
  group: string,
  type: LearningConfigType,
  unit: LearningConfigUnit | undefined,
  syllabusValue: LearningConfigValue,
  extra: Partial<LearningConfigKeyDef> = {},
): LearningConfigKeyDef => ({
  key, label, group, type, unit, min: 1, kind: 'SYLLABUS', perMode: false, syllabusValue, openQuestions: ['OQ-012'], ...extra,
});

const prescribed = (
  key: string,
  label: string,
  group: string,
  type: LearningConfigType,
  openQuestions: readonly string[],
  extra: Partial<LearningConfigKeyDef> = {},
): LearningConfigKeyDef => ({ key, label, group, type, kind: 'PRESCRIBED', perMode: false, openQuestions, ...extra });

/* Attendance statuses of the baseline register (L-17, OQ-014) and the learner client types (DB-331). */
export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const;
export const CLIENT_TYPES = ['APP', 'WEB'] as const;
/* F-LMS-13-06: trainer-marked baseline; self check-in is a feature flag (OQ-014). */
export const ATTENDANCE_CAPTURE_METHODS = ['trainer_marked', 'self_check_in'] as const;

export const LEARNING_CONFIG_KEYS: readonly LearningConfigKeyDef[] = [
  /* ---- First kind: final syllabus documents (L-05; §2.1 Table 7; OQ-012) ---- */
  syllabus('core_hours.module_1', 'Core hours — Module 1', 'Core hours', 'integer', 'hours', 60),
  syllabus('core_hours.module_2', 'Core hours — Module 2', 'Core hours', 'integer', 'hours', 60),
  syllabus('core_hours.module_3', 'Core hours — Module 3', 'Core hours', 'integer', 'hours', 300),
  syllabus('core_hours.module_4', 'Core hours — Module 4', 'Core hours', 'integer', 'hours', 80),
  syllabus('session_length', 'Session length', 'Sessions', 'duration', 'hours', 2),
  syllabus('sessions.module_1', 'Sessions — Module 1', 'Sessions', 'integer', 'sessions', 30),
  syllabus('sessions.module_2', 'Sessions — Module 2', 'Sessions', 'integer', 'sessions', 30),
  syllabus('sessions.module_4', 'Sessions — Module 4', 'Sessions', 'integer', 'sessions', 40),
  syllabus('module_3.lecture_hours', 'Module 3 lecture hours', 'Module 3', 'integer', 'hours', 150),
  syllabus('module_3.practical_hours', 'Module 3 practical hours', 'Module 3', 'integer', 'hours', 150),
  syllabus('oft_hours.module_1', 'OFT hours range — Module 1', 'On Field Training', 'range', 'hours', { min: 42, max: 48 }),
  syllabus('oft_hours.module_2', 'OFT hours range — Module 2', 'On Field Training', 'range', 'hours', { min: 42, max: 48 }),
  syllabus('oft_hours.module_3', 'OFT hours range — Module 3', 'On Field Training', 'range', 'hours', { min: 210, max: 240 }),
  syllabus('oft_hours.module_4', 'OFT hours range — Module 4', 'On Field Training', 'range', 'hours', { min: 56, max: 64 }),
  /* §2.1: "1 Beginning · 2 Developing · 3 Competent · 4 Proficient · 5 Strong" (band 3 is not a pass mark). */
  syllabus('competency_bands', 'Competency band labels (1 to 5)', 'Competency bands', 'labels', undefined, [
    'Beginning', 'Developing', 'Competent', 'Proficient', 'Strong',
  ], { length: 5, min: undefined }),

  /* ---- Second kind: prescribed by the competent authority — To Be Confirmed until set ---- */
  prescribed('assessment.progression_standard', 'Standard required for progression', 'Assessment', 'text', ['OQ-013']),
  prescribed('assessment.attempt_limit', 'Attempt limit', 'Assessment', 'integer', ['OQ-013'], { unit: 'attempts', min: 1 }),
  prescribed('assessment.reassessment_limit', 'Re-assessment limit', 'Assessment', 'integer', ['OQ-013'], { unit: 'attempts', min: 0 }),
  prescribed('assessment.late_submission_policy', 'Late-submission policy', 'Assessment', 'text', ['OQ-013']),
  prescribed('assessment.result_release_mode', 'Result-release mode', 'Assessment', 'text', ['OQ-013', 'OQ-015']),
  prescribed('attendance.requirement', 'Attendance requirement', 'Attendance', 'percentage', ['OQ-014'], { unit: 'percent' }),
  prescribed('progress.video_watched_threshold', 'Video-watched threshold', 'Progress', 'percentage', ['OQ-015'], { unit: 'percent' }),
  prescribed('progress.inactivity_threshold', 'Inactivity threshold', 'Progress', 'duration', ['OQ-015'], { unit: 'days', min: 1 }),

  /* ---- Rule sets per delivery mode (L-05; OQ-042, OQ-029): one value for Offline, one for Online ---- */
  prescribed('attendance.capture_method', 'Attendance capture method', 'Delivery mode rules', 'enum', ['OQ-014', 'OQ-042'], {
    perMode: true, options: ATTENDANCE_CAPTURE_METHODS,
  }),
  prescribed('attendance.lock_period', 'Attendance lock period', 'Delivery mode rules', 'duration', ['OQ-014', 'OQ-042'], {
    perMode: true, unit: 'hours', min: 0,
  }),
  prescribed('attendance.counted_statuses', 'Counted attendance statuses', 'Delivery mode rules', 'enum-list', ['OQ-014', 'OQ-042'], {
    perMode: true, options: ATTENDANCE_STATUSES,
  }),
  prescribed('session.reminder_lead_time', 'Session reminder lead time', 'Delivery mode rules', 'duration', ['OQ-042'], {
    perMode: true, unit: 'minutes', min: 0,
  }),
  prescribed('assessment.allowed_client_types', 'Client types allowed for formal assessments', 'Delivery mode rules', 'enum-list', ['OQ-042'], {
    perMode: true, options: CLIENT_TYPES,
  }),
];

export const LEARNING_CONFIG_KEY_MAP = new Map(LEARNING_CONFIG_KEYS.map((k) => [k.key, k]));
