import {
  ASSESSMENT_WEIGHT_TOTAL, LEARNING_COMPONENT_KINDS, LEARNING_COMPONENT_LABELS, VARIANT_ASSESSMENT_COMPONENTS, VARIANT_PHASES,
  VARIANT_READINESS_GATES, type LearningComponentKind,
} from './track-variant.constants';
import type { CompletenessItem, TrackVariantCompleteness, TrackVariantCounts, TrackVariantCourseModule } from './track-variant.types';

/*
 * The completeness check of a Module 3 variant (L-07): "lists what is missing against that shape: phases,
 * track modules, sessions and lessons, OFT cards (L-35), readiness gates (L-36) and the ten-component
 * assessment framework (L-18)"; "A variant with fewer than seven phases, without its six readiness gates or
 * without its OFT cards is reported as incomplete and cannot be included in a release" (TC-359).
 *
 * Checked here: phases (7), track modules (the variant's own 22 / 23), OFT cards (its own 12 / 13, retired cards
 * not counted), readiness gates (6), assessment components (10; weights, once any is entered, all entered and
 * totalling 100 — F-LMS-18-10 / BRL-344) and the learning components of the shape (mini and integration
 * projects, capstone, business simulation, portfolio). Sessions and lessons belong to the lesson master
 * (L-08), which is not built: they are not checked yet.
 *
 * Warnings, never blocking: track-module hours against the module's core hours (L-08), and the sum of OFT card
 * maxima below the module's OFT lower bound (L-35 error scenarios).
 *
 * ONE rule, two forms: completeSql() filters lists in SQL, evaluateCompleteness() reports in the API. Both use
 * COUNT_SQL; keep them in step.
 */

const live = (table: string, v: string, extra = '') =>
  `FROM "${table}" x WHERE x."trackVariantId" = ${v}."id" AND x."isDelete" = false${extra}`;

/* Per-variant aggregates, as SQL expressions on the variant alias `v`. */
export const COUNT_SQL = {
  phases: (v: string) => `(SELECT count(*)::int ${live('lms_track_variant_phases', v)})`,
  phaseNumbers: (v: string) =>
    `(SELECT COALESCE(array_agg(x."phaseNumber" ORDER BY x."phaseNumber"), '{}')::int[] ${live('lms_track_variant_phases', v)})`,
  trackModules: (v: string) => `(SELECT count(*)::int ${live('lms_track_variant_modules', v)})`,
  trackModuleHours: (v: string) =>
    `(SELECT COALESCE(sum(COALESCE(x."lectureHours", 0) + COALESCE(x."practicalHours", 0)), 0)::float8 ${live('lms_track_variant_modules', v)})`,
  hoursEntered: (v: string) =>
    `(SELECT count(*)::int ${live('lms_track_variant_modules', v, ` AND (x."lectureHours" IS NOT NULL OR x."practicalHours" IS NOT NULL)`)})`,
  oftCards: (v: string) => `(SELECT count(*)::int ${live('lms_track_variant_oft_cards', v, ` AND x."status" <> 'RETIRED'`)})`,
  oftHoursMin: (v: string) =>
    `(SELECT COALESCE(sum(x."hoursMin"), 0)::float8 ${live('lms_track_variant_oft_cards', v, ` AND x."status" <> 'RETIRED'`)})`,
  oftHoursMax: (v: string) =>
    `(SELECT COALESCE(sum(x."hoursMax"), 0)::float8 ${live('lms_track_variant_oft_cards', v, ` AND x."status" <> 'RETIRED'`)})`,
  readinessGates: (v: string) => `(SELECT count(*)::int ${live('lms_track_variant_readiness_gates', v)})`,
  gateNumbers: (v: string) =>
    `(SELECT COALESCE(array_agg(x."gateNumber" ORDER BY x."gateNumber"), '{}')::int[] ${live('lms_track_variant_readiness_gates', v)})`,
  assessmentComponents: (v: string) => `(SELECT count(*)::int ${live('lms_track_variant_assessment_components', v)})`,
  weightedComponents: (v: string) =>
    `(SELECT count(x."weight")::int ${live('lms_track_variant_assessment_components', v)})`,
  weightTotal: (v: string) => `(SELECT COALESCE(sum(x."weight"), 0)::float8 ${live('lms_track_variant_assessment_components', v)})`,
  learningComponent: (v: string, kind: LearningComponentKind) =>
    `(SELECT count(*)::int ${live('lms_track_variant_components', v, ` AND x."kind" = '${kind}'`)})`,
};

/* The SQL form of evaluateCompleteness(...).complete, for the ?completeness= filter. */
export function completeSql(v: string): string {
  const c = COUNT_SQL;
  return `(
    ${c.phases(v)} = ${VARIANT_PHASES}
    AND ${v}."expectedTrackModules" IS NOT NULL AND ${c.trackModules(v)} = ${v}."expectedTrackModules"
    AND ${v}."expectedOftCards" IS NOT NULL AND ${c.oftCards(v)} = ${v}."expectedOftCards"
    AND ${c.readinessGates(v)} = ${VARIANT_READINESS_GATES}
    AND ${c.assessmentComponents(v)} = ${VARIANT_ASSESSMENT_COMPONENTS}
    AND (${c.weightedComponents(v)} = 0
      OR (${c.weightedComponents(v)} = ${c.assessmentComponents(v)} AND ${c.weightTotal(v)} = ${ASSESSMENT_WEIGHT_TOTAL}))
    ${LEARNING_COMPONENT_KINDS.map((k) => `AND ${c.learningComponent(v, k)} >= 1`).join('\n    ')}
  )`;
}

/* The SELECT list of the counts query (alias → expression). */
export function countsSelect(v: string): [string, string][] {
  const c = COUNT_SQL;
  return [
    ['phases', c.phases(v)],
    ['phaseNumbers', c.phaseNumbers(v)],
    ['trackModules', c.trackModules(v)],
    ['trackModuleHours', c.trackModuleHours(v)],
    ['hoursEntered', c.hoursEntered(v)],
    ['oftCards', c.oftCards(v)],
    ['oftHoursMin', c.oftHoursMin(v)],
    ['oftHoursMax', c.oftHoursMax(v)],
    ['readinessGates', c.readinessGates(v)],
    ['gateNumbers', c.gateNumbers(v)],
    ['assessmentComponents', c.assessmentComponents(v)],
    ['weightedComponents', c.weightedComponents(v)],
    ['weightTotal', c.weightTotal(v)],
    ...LEARNING_COMPONENT_KINDS.map((k): [string, string] => [`lc_${k}`, c.learningComponent(v, k)]),
  ];
}

/* Raw row of the counts query to TrackVariantCounts. */
export function toCounts(r: Record<string, unknown>): TrackVariantCounts {
  const n = (k: string) => Number(r[k] ?? 0);
  const arr = (k: string) => ((r[k] as (number | string)[] | null) ?? []).map(Number);
  return {
    phases: n('phases'),
    phaseNumbers: arr('phaseNumbers'),
    trackModules: n('trackModules'),
    trackModuleHours: n('trackModuleHours'),
    hoursEntered: n('hoursEntered'),
    oftCards: n('oftCards'),
    oftHoursMin: n('oftHoursMin'),
    oftHoursMax: n('oftHoursMax'),
    readinessGates: n('readinessGates'),
    gateNumbers: arr('gateNumbers'),
    assessmentComponents: n('assessmentComponents'),
    weightedComponents: n('weightedComponents'),
    weightTotal: n('weightTotal'),
    learningComponents: Object.fromEntries(LEARNING_COMPONENT_KINDS.map((k) => [k, n(`lc_${k}`)])) as Record<LearningComponentKind, number>,
  };
}

const missingNumbers = (present: number[], total: number) =>
  Array.from({ length: total }, (_, i) => i + 1).filter((x) => !present.includes(x));

const list = (xs: (string | number)[]) => (xs.length === 1 ? `${xs[0]}` : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

const round = (x: number) => Math.round(x * 100) / 100;

export function evaluateCompleteness(
  variant: { expectedTrackModules: number | null; expectedOftCards: number | null },
  c: TrackVariantCounts,
  module: Pick<TrackVariantCourseModule, 'coreHours' | 'oftHoursMin'>,
): TrackVariantCompleteness {
  const missing: CompletenessItem[] = [];
  const warnings: CompletenessItem[] = [];

  if (c.phases !== VARIANT_PHASES) {
    const gap = missingNumbers(c.phaseNumbers, VARIANT_PHASES);
    missing.push({ item: 'phases', message: `${c.phases} of ${VARIANT_PHASES} phases; missing phase ${list(gap)}.` });
  }

  if (variant.expectedTrackModules === null) {
    missing.push({ item: 'trackModules', message: 'Enter the number of track modules from the track syllabus.' });
  } else if (c.trackModules !== variant.expectedTrackModules) {
    missing.push({ item: 'trackModules', message: `${c.trackModules} of ${variant.expectedTrackModules} track modules.` });
  }

  if (variant.expectedOftCards === null) {
    missing.push({ item: 'oftCards', message: 'Enter the number of OFT cards from the track syllabus.' });
  } else if (c.oftCards !== variant.expectedOftCards) {
    missing.push({ item: 'oftCards', message: `${c.oftCards} of ${variant.expectedOftCards} OFT cards.` });
  }

  if (c.readinessGates !== VARIANT_READINESS_GATES) {
    const gap = missingNumbers(c.gateNumbers, VARIANT_READINESS_GATES);
    missing.push({ item: 'readinessGates', message: `${c.readinessGates} of ${VARIANT_READINESS_GATES} readiness gates; missing gate ${list(gap)}.` });
  }

  if (c.assessmentComponents !== VARIANT_ASSESSMENT_COMPONENTS) {
    missing.push({
      item: 'assessmentComponents',
      message: `${c.assessmentComponents} of ${VARIANT_ASSESSMENT_COMPONENTS} assessment framework components.`,
    });
  }
  const weighted = c.weightedComponents > 0;
  if (weighted && (c.weightedComponents !== c.assessmentComponents || round(c.weightTotal) !== ASSESSMENT_WEIGHT_TOTAL)) {
    missing.push({
      item: 'assessmentWeights',
      message: `The weights must total ${ASSESSMENT_WEIGHT_TOTAL} (now ${round(c.weightTotal)}, ${c.weightedComponents} of ${c.assessmentComponents} components weighted).`,
    });
  }

  for (const k of LEARNING_COMPONENT_KINDS) {
    if (c.learningComponents[k] < 1) missing.push({ item: 'learningComponents', message: `No ${LEARNING_COMPONENT_LABELS[k]}.` });
  }

  /* L-08: the sum of the track modules' hours against the module's core hours — a warning, not a block. */
  if (module.coreHours !== null && c.hoursEntered > 0 && round(c.trackModuleHours) !== round(module.coreHours)) {
    warnings.push({
      item: 'trackModuleHours',
      message: `The track modules add up to ${round(c.trackModuleHours)} hours; the module's core hours are ${module.coreHours}.`,
    });
  }
  /* L-35: "sum of card maxima of a module below the module's OFT lower bound: warning on the completeness check". */
  if (module.oftHoursMin !== null && c.oftCards > 0 && c.oftHoursMax < module.oftHoursMin) {
    warnings.push({
      item: 'oftHours',
      message: `The OFT cards allow at most ${round(c.oftHoursMax)} hours, below the module's OFT minimum of ${module.oftHoursMin} hours.`,
    });
  }

  return {
    complete: missing.length === 0,
    phases: { actual: c.phases, required: VARIANT_PHASES },
    trackModules: { actual: c.trackModules, required: variant.expectedTrackModules },
    oftCards: { actual: c.oftCards, required: variant.expectedOftCards, hoursMin: round(c.oftHoursMin), hoursMax: round(c.oftHoursMax) },
    readinessGates: { actual: c.readinessGates, required: VARIANT_READINESS_GATES },
    assessmentComponents: {
      actual: c.assessmentComponents,
      required: VARIANT_ASSESSMENT_COMPONENTS,
      weightTotal: weighted ? round(c.weightTotal) : null,
    },
    learningComponents: c.learningComponents,
    missing,
    warnings,
  };
}
