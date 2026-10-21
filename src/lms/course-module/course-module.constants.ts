/*
 * The four prescribed programme modules — the CONFIRMED values of the final syllabus documents, in ONE place.
 *
 * Sources (AMRUT_KALASH_03 LMS Admin specification):
 * - Section 2.1 "Programme learning model", Table 7 "Four-module learning model — source: final syllabus
 *   documents" (titles, core hours, delivery, OFT hours, structure).
 * - L-06 / FR-306 business rules (section 8.2.1) and BRL-335: "Core hours (60, 60, 300, 80), sessions (30 × 2 h,
 *   30 × 2 h, 150 lecture + 150 practical hours, 40 × 2 h), OFT ranges (42–48, 42–48, 210–240, 56–64) …
 *   seeded from the final syllabus documents into editable fields with a syllabus reference".
 * - F-LMS-07-02 / -04 / -07 / -08 defaults (Table 32).
 *
 * These are configuration DEFAULTS, not logic (BRL-335): the documents are marked "Draft for review and
 * approval by the competent authority" (OQ-012, Open — "Not blocking (values supplied)"); an approved change
 * is made on the module record, never here. Nothing in the code depends on a particular value.
 *
 * Deliberately left empty (the spec does not give them):
 * - syllabusRef: F-LMS-07-05 defaults it to "Title of the final syllabus document" but no document title or
 *   version is given — the Academic/Course Manager enters it, and POST /prescribed requires it ("Required
 *   with core hours").
 * - description: F-LMS-07-06 is optional with no default.
 * OFT is 70–80 % of the core hours as given in the syllabus (BRL-336); the ranges below are that value.
 */
export const MODULE_NUMBERS = [1, 2, 3, 4] as const;
export type ModuleNumber = (typeof MODULE_NUMBERS)[number];

/* L-06 "Course / module: DRAFT → PUBLISHED → RETIRED"; set through content releases (L-30, not built). */
export const MODULE_STATUSES = ['DRAFT', 'PUBLISHED', 'RETIRED'] as const;
export type ModuleStatus = (typeof MODULE_STATUSES)[number];

export interface PrescribedModule {
  moduleNumber: ModuleNumber;
  title: string;
  coreHours: number;
  sessions: number | null;
  sessionHours: number | null;
  lectureHours: number | null;
  practicalHours: number | null;
  oftHoursMin: number;
  oftHoursMax: number;
  syllabusRef: null;
  description: null;
  /* Read-only information from Table 7 / L-06 ("Structure"); not stored on the module record. */
  structure: { units?: number; assignments?: number; oftAssignments?: number; note?: string };
  /* Table 7 "Formal assessment" — configured in L-18, shown for reference only. */
  formalAssessment: string;
}

export const PRESCRIBED_MODULES: readonly PrescribedModule[] = [
  {
    moduleNumber: 1,
    title: 'Personality Development, Communication, Programme Orientation & Entrepreneurship Foundation',
    coreHours: 60,
    /* "30 sessions × 2 hours (theory 22 · practical 38)" */
    sessions: 30,
    sessionHours: 2,
    lectureHours: 22,
    practicalHours: 38,
    oftHoursMin: 42,
    oftHoursMax: 48,
    syllabusRef: null,
    description: null,
    structure: { units: 5, oftAssignments: 5, note: 'Orientation to all 12 technology tracks (1 hour each)' },
    formalAssessment: 'Assessment 1, after the module',
  },
  {
    moduleNumber: 2,
    title: 'Basic Information Technology Skills',
    coreHours: 60,
    /* "30 sessions × 2 hours" */
    sessions: 30,
    sessionHours: 2,
    lectureHours: null,
    practicalHours: null,
    oftHoursMin: 42,
    oftHoursMax: 48,
    syllabusRef: null,
    description: null,
    structure: { oftAssignments: 10, note: 'Technology Track Readiness check' },
    formalAssessment: 'Assessment 2, on completion of the module',
  },
  {
    moduleNumber: 3,
    /* Table 7: "Domain-Specific Basic Digital Skills — the candidate's one selected technology track". */
    title: 'Domain-Specific Basic Digital Skills',
    coreHours: 300,
    /* "150 hours lecture + 150 hours practical" */
    sessions: null,
    sessionHours: null,
    lectureHours: 150,
    practicalHours: 150,
    oftHoursMin: 210,
    oftHoursMax: 240,
    syllabusRef: null,
    description: null,
    structure: { note: 'One variant per technology track (Track Variant master): 7 phases, 22–23 track modules, 12–13 OFT cards, 6 readiness gates' },
    formalAssessment: 'Track assessment framework (ten components)',
  },
  {
    moduleNumber: 4,
    title: 'Domain-Specific Advanced Digital Skills',
    coreHours: 80,
    /* "40 sessions × 2 hours" */
    sessions: 40,
    sessionHours: 2,
    lectureHours: null,
    practicalHours: null,
    oftHoursMin: 56,
    oftHoursMax: 64,
    syllabusRef: null,
    description: null,
    structure: { units: 9, assignments: 12, oftAssignments: 9, note: 'Capstone business and marketing plan · programme portfolio' },
    formalAssessment: 'Assessment 4, after the module',
  },
];
