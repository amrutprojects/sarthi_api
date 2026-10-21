/* A Marathi/English pair, matching the website's Bilingual type (public-site/content/types.ts). */
export interface Bilingual {
  mr: string;
  en: string;
}

/* ---------------- shared shapes ---------------- */

/*
 * How one module's hours divide. The same split applies to every module, which is why it lives on
 * the settings row rather than on each card.
 */
export interface ModuleTimeSplit {
  moduleHours: number;
  trainingHours: number;
  assessmentHours: number;
  weeksPerModule: number;
  daysPerWeek: number;
  hoursPerDay: number;
  weeklyAssessmentHours: number;
}

export interface LearningPath {
  sessionLength: Bilingual;
  sessionLabel: Bilingual;
  fixedPathPct: number;
  selfPathPct: number;
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
  name: Bilingual;
  description: Bilingual;
  elective: boolean;
  displayOrder: number;
  isActive: boolean;
  /* This module's own domains. Empty for a core module. */
  electives: AdminElectiveDomain[];
}

export interface AdminModulesPage {
  id: string;
  modules: AdminModule[];
  timeSplit: ModuleTimeSplit;
  learningPath: LearningPath;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/* ---------------- public shapes ---------------- */

/*
 * What the website receives. Narrower than the admin shape on purpose: no ids, no timestamps, no
 * publication flag, no soft-delete state. The field names match what the site already expects in
 * public-site/data/modules.ts, so it needs no translation layer of its own.
 */
export interface PublicElectiveDomain {
  no: number;
  domain: Bilingual;
  certificate: string;
}

export interface PublicModule {
  no: number;
  code: string;
  name: Bilingual;
  description: Bilingual;
  elective: boolean;
  electives: PublicElectiveDomain[];
}

export interface PublicModulesPage {
  modules: PublicModule[];
  timeSplit: ModuleTimeSplit;
  learningPath: LearningPath;
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
  name: Bilingual;
  description: Bilingual;
  elective?: boolean;
  displayOrder?: number;
  isActive?: boolean;
  electives?: UpdateElectiveDomainInput[];
}

export interface UpdateModulesPageInput {
  modules: UpdateModuleInput[];
  timeSplit: ModuleTimeSplit;
  learningPath: LearningPath;
  isPublished?: boolean;
}
