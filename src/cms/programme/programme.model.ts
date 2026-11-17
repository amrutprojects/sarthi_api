import { Column, Entity } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/* A Marathi / English pair, as the public site renders it through bi(). Both are always required. */
export interface BilingualText {
  mr: string;
  en: string;
}
export interface MethodologyRow {
  label: BilingualText;
  value: BilingualText;
}
export interface AssessmentRow {
  component: BilingualText;
  min: number;
  max: number;
}
/* The 'Two independent training modes' box: a heading, the modes (OFFLINE / ONLINE) and the note under them. */
export interface TrainingMode {
  name: BilingualText;
  description: BilingualText;
}
export interface TrainingModes {
  title: BilingualText;
  modes: TrainingMode[];
  note: BilingualText;
}
/*
 * The programme fact sheet. Total hours, the module line and the elective count are absent: the site sums them from the modules.
 * The two durations are a number of months or a range of them, always in the normalised form "N" or "N-M" ("6", "4-6").
 */
export interface ProgrammeFacts {
  idealMonths: string;
  validityMonths: string;
  securityDeposit: number;
  applyLeadDays: number;
  partnerName: string;
}
/*
 * The rows of the fact sheet's box on the website, in display order, each of which the admin can hide. Fixed: the
 * website owns the labels and works out the first three from the modules, so a key is all the CMS stores. The same
 * list is CHK_programme_page_settings_hidden_facts (ProgrammeHiddenFacts migration).
 */
export const PROGRAMME_FACT_KEYS = [
  'totalHours',
  'modules',
  'electives',
  'idealDuration',
  'validity',
  'securityDeposit',
  'applyBefore',
  'partner',
] as const;
export type ProgrammeFactKey = (typeof PROGRAMME_FACT_KEYS)[number];

/*
 * Programme page content (public site /programme): the introduction, objectives, learning methodology, assessment
 * and passing criteria, certification, and the programme fact sheet. A singleton: the database admits exactly one non-deleted row
 * (UQ_programme_page_settings_singleton, a unique index on a constant expression), created by the seed.
 *
 * The lists are stored as JSONB arrays of bilingual items: they are always read and replaced as a whole by the
 * admin screen, in the order shown, and never queried item by item. Shape and limits are enforced by the request
 * validator; the database checks that each is an array.
 */
@Entity({ name: 'programme_page_settings' })
export class ProgrammePageSettings extends AppBaseEntity {
  @Column({ type: 'varchar', length: 500, name: 'introMr' }) introMr!: string;
  @Column({ type: 'varchar', length: 500, name: 'introEn' }) introEn!: string;
  @Column({ type: 'jsonb', name: 'objectives' }) objectives!: BilingualText[];
  @Column({ type: 'jsonb', name: 'methodology' }) methodology!: MethodologyRow[];
  @Column({ type: 'jsonb', name: 'assessment' }) assessment!: AssessmentRow[];
  @Column({ type: 'varchar', length: 500, name: 'assessmentNoteMr' }) assessmentNoteMr!: string;
  @Column({ type: 'varchar', length: 500, name: 'assessmentNoteEn' }) assessmentNoteEn!: string;
  @Column({ type: 'jsonb', name: 'certification' }) certification!: BilingualText[];
  @Column({ type: 'jsonb', name: 'trainingModes' }) trainingModes!: TrainingModes;
  /*
   * The programme fact sheet: the figures that are entered rather than derived. Total hours, the module line and the
   * elective count are NOT stored: the site sums them from the modules, so they cannot contradict them.
   * The two durations are text, a number of months or a range ("6", "4-6"), stored in the normalised form the validator
   * produces; CHK_programme_page_settings_ideal_months / _validity_months admit only that form (ProgrammeMonthRanges
   * migration). CHK_programme_page_settings_facts keeps the other two numbers non-negative; CHK_programme_page_settings_partner
   * the name non-blank.
   */
  @Column({ type: 'varchar', length: 7, name: 'idealMonths', default: '6' }) idealMonths!: string;
  @Column({ type: 'varchar', length: 7, name: 'validityMonths', default: '12' }) validityMonths!: string;
  @Column({ type: 'integer', name: 'securityDeposit', default: 2000 }) securityDeposit!: number;
  @Column({ type: 'integer', name: 'applyLeadDays', default: 30 }) applyLeadDays!: number;
  @Column({ type: 'varchar', length: 150, name: 'partnerName', default: 'SUMAGO INFOTECH PVT LTD' }) partnerName!: string;
  /*
   * The fact sheet rows the website leaves out. Written only by the per-row switch (PATCH /facts/:key), never by the
   * full-page PUT, so saving the edit form cannot bring a hidden row back. Empty: every row is shown.
   */
  @Column({ type: 'text', array: true, name: 'hiddenFacts', default: () => "'{}'" }) hiddenFacts!: ProgrammeFactKey[];
  /* Unpublishing hides the managed content from the public API; the website then shows its own copy. */
  @Column({ type: 'boolean', name: 'isPublished', default: true }) isPublished!: boolean;
}
