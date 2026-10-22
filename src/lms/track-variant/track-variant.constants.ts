/*
 * Fixed values of the Track Variant Master (AMRUT_KALASH_03 L-07 / FR-307), each in ONE place.
 *
 * Line numbers refer to the LMS Admin specification as markdown (03_lms_admin.md).
 *
 * The Module 3 shape. Every Module 3 variant has the same shape, loaded from the track's syllabus:
 * "300 core hours (150 lecture + 150 practical), seven phases, 22 or 23 track modules, mini and integration
 * projects, 12 or 13 OFT cards, a capstone project, a business simulation, six readiness gates and a
 * portfolio" — L-07 business rules (line 950); Table 7 Module 3 row (line 281); F-LMS-07-09 structure counts
 * "Phases 7; track modules 22 or 23 per track; OFT cards 12 or 13 per track; readiness gates 6" (line 1892);
 * BRL-335 (line 2478). "The exact count of track modules and OFT cards is stored per track" (line 950), so
 * those two are columns of the variant (expectedTrackModules / expectedOftCards), entered from the track's
 * syllabus and checked against the ranges below; they stay empty until entered (no per-track value is
 * given by the specification, so none is assumed).
 */

/* Seven phases per variant — L-07 (line 950), Table 7 (line 281), DB-310 (line 4748). Phase numbers 1–7. */
export const VARIANT_PHASES = 7;

/* Six readiness gates, numbered 1 to 6 — F-LMS-32-02 (line 2353), L-36 "Seventh gate … refused" (line 1360). */
export const VARIANT_READINESS_GATES = 6;

/* 22 or 23 track modules per track — L-07 (line 950), F-LMS-07-09 (line 1892). */
export const VARIANT_TRACK_MODULES = { min: 22, max: 23 } as const;

/* 12 or 13 OFT cards per track — L-07 (line 950), L-35 (line 1330), F-LMS-07-09 (line 1892). */
export const VARIANT_OFT_CARDS = { min: 12, max: 13 } as const;

/* The ten-component Module 3 assessment framework — F-LMS-18-10 (line 2109), glossary (line 5808). */
export const VARIANT_ASSESSMENT_COMPONENTS = 10;

/* Component weights must total 100 to publish — F-LMS-18-10 (line 2109), BRL-344 (line 2487). */
export const ASSESSMENT_WEIGHT_TOTAL = 100;

/* Programme module number of the track variants — L-06 / L-07 (lines 928, 950). */
export const TRACK_VARIANT_MODULE_NUMBER = 3;

/* Variant, OFT card lifecycle: DRAFT → PUBLISHED → RETIRED (L-07 line 951, F-LMS-29-12 line 2308). */
export const CURRICULUM_STATUSES = ['DRAFT', 'PUBLISHED', 'RETIRED'] as const;
export type CurriculumStatus = (typeof CURRICULUM_STATUSES)[number];

/*
 * Learning components of the shape other than OFT cards, gates and the assessment framework: "mini and
 * integration projects, … a capstone project, a business simulation … and a portfolio" (L-07 line 950). The
 * kinds are those of F-LMS-20-03 (line 2141) plus the portfolio. One capstone, one business simulation and one
 * portfolio per variant (the shape names each in the singular); mini and integration projects may be several.
 */
export const LEARNING_COMPONENT_KINDS = ['MINI_PROJECT', 'INTEGRATION_PROJECT', 'CAPSTONE_PROJECT', 'BUSINESS_SIMULATION', 'PORTFOLIO'] as const;
export type LearningComponentKind = (typeof LEARNING_COMPONENT_KINDS)[number];
export const SINGLE_LEARNING_COMPONENTS: readonly LearningComponentKind[] = ['CAPSTONE_PROJECT', 'BUSINESS_SIMULATION', 'PORTFOLIO'];
export const LEARNING_COMPONENT_LABELS: Record<LearningComponentKind, string> = {
  MINI_PROJECT: 'mini project',
  INTEGRATION_PROJECT: 'integration project',
  CAPSTONE_PROJECT: 'capstone project',
  BUSINESS_SIMULATION: 'business simulation',
  PORTFOLIO: 'portfolio',
};

/*
 * Evidence types of an OFT card (F-LMS-29-09, line 2305: "for example photographs, field log, document, link,
 * host note") and of a readiness gate (F-LMS-32-06, line 2357). The specification lists these as examples
 * only; the column CHECK fixes the shape, so a confirmed list changes this constant only.
 */
export const EVIDENCE_TYPES = ['PHOTOGRAPH', 'FIELD_LOG', 'DOCUMENT', 'LINK', 'HOST_NOTE'] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/*
 * Readiness gate clearance rule (F-LMS-32-08, line 2359): 'assessor decides' (default) or 'minimum band'
 * (1–5). No minimum band is assumed — To Be Confirmed (OQ-013).
 */
export const GATE_CLEARANCE_MODES = ['ASSESSOR_DECIDES', 'MINIMUM_BAND'] as const;
export type GateClearanceMode = (typeof GATE_CLEARANCE_MODES)[number];
export const COMPETENCY_BANDS = { min: 1, max: 5 } as const;

/*
 * F-LMS-29-01 (line 2297): OFT-M{module}-{nn}, with the track code for Module 3 (e.g. OFT-M3-T07-04). The
 * track part is the variant's own track code; nn is two digits.
 */
export const oftCodePattern = (trackCode: string) => new RegExp(`^OFT-M${TRACK_VARIANT_MODULE_NUMBER}-${trackCode}-\\d{2}$`);
export const OFT_CODE_SHAPE = /^OFT-M3-T\d{2}-\d{2}$/;

/* numeric columns come back from PostgreSQL as strings; the API speaks numbers (as lms_course_modules does). */
export const numericColumn = {
  to: (v: number | null | undefined) => v,
  from: (v: string | null) => (v === null ? null : Number(v)),
};
