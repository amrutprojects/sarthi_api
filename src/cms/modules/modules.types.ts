import type { ModuleKind } from './modules.model';

/* A Marathi/English pair, matching the website's Bilingual type (public-site/content/types.ts). */
export interface Bilingual {
  mr: string;
  en: string;
}

/* ---------------- shared shapes ---------------- */

/** One module's own timetable. Training plus assessment must equal the module total. */
export interface ModuleTimeSplit {
  moduleHours: number;
  trainingHours: number;
  assessmentHours: number;
  weeksPerModule: number;
  daysPerWeek: number;
  hoursPerDay: number;
  weeklyAssessmentHours: number;
}

/** The two shares of the learning-path donut. They must total 100. */
export interface LearningPath {
  sessionLength: Bilingual;
  sessionLabel: Bilingual;
  fixedPathPct: number;
  selfPathPct: number;
}

/** Figures the home page prints that the module lists cannot supply. */
export interface ProgrammeStats {
  districtCount: number;
}

/* ---------------- admin shapes ---------------- */

export interface AdminElectiveDomain {
  id: string;
  no: number;
  domain: Bilingual;
  /* What this module awards in this domain. */
  certificate: string;
  displayOrder: number;
  isActive: boolean;
}

export interface AdminModule {
  id: string;
  no: number;
  code: string;
  kind: ModuleKind;
  /* Whether the website prints the "Elective" badge on this card. Read only for an ELECTIVE. */
  showElectiveLabel: boolean;
  name: Bilingual;
  description: Bilingual;
  /* This module's own timetable. */
  timeSplit: ModuleTimeSplit;
  displayOrder: number;
  /*
   * Whether this module is shown on the website and counted in the programme totals. For an
   * elective this is the "include it" tick box; a module that is off appears nowhere and adds
   * nothing to the hours.
   */
  isActive: boolean;
  /* This module's own domains. */
  electives: AdminElectiveDomain[];
}

export interface AdminModulesPage {
  id: string;
  pageTitle: Bilingual;
  pageSubtitle: Bilingual;
  modules: AdminModule[];
  learningPath: LearningPath;
  stats: ProgrammeStats;
  createdAt: Date;
  updatedAt: Date;
}

/* ---------------- public shapes ---------------- */

/*
 * What the website receives. Narrower than the admin shape on purpose: no ids, no timestamps, no
 * soft-delete state. Only active modules and domains are included, which is what makes an
 * unticked elective vanish from both the page and the totals.
 */
export interface PublicElectiveDomain {
  no: number;
  domain: Bilingual;
  certificate: string;
}

export interface PublicModule {
  no: number;
  code: string;
  kind: ModuleKind;
  /* The site prints the "Elective" badge on an ELECTIVE card only when this is true. */
  showElectiveLabel: boolean;
  name: Bilingual;
  description: Bilingual;
  timeSplit: ModuleTimeSplit;
  electives: PublicElectiveDomain[];
}

export interface PublicModulesPage {
  pageTitle: Bilingual;
  pageSubtitle: Bilingual;
  modules: PublicModule[];
  learningPath: LearningPath;
  stats: ProgrammeStats;
}

/* ---------------- write shapes ---------------- */

export interface UpdateElectiveDomainInput {
  no: number;
  domain: Bilingual;
  certificate: string;
  displayOrder?: number;
  isActive?: boolean;
}

export interface UpdateModuleInput {
  no: number;
  code: string;
  kind: ModuleKind;
  /* Defaults to true when omitted, so a client that does not send it keeps the badge. */
  showElectiveLabel?: boolean;
  name: Bilingual;
  description: Bilingual;
  timeSplit: ModuleTimeSplit;
  displayOrder?: number;
  isActive?: boolean;
  electives?: UpdateElectiveDomainInput[];
}

/*
 * The write shape. `stats` is absent on purpose: the home page figures are written through
 * /cms/hero (Home Hero Section), which is their only writer — two screens writing one field is how
 * they drift.
 */
export interface UpdateModulesPageInput {
  pageTitle: Bilingual;
  pageSubtitle: Bilingual;
  modules: UpdateModuleInput[];
  learningPath: LearningPath;
}
