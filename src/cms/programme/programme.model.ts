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
/* The programme fact sheet. Total hours, the module line and the elective count are absent: the site sums them from the modules. */
export interface ProgrammeFacts {
  idealMonths: number;
  validityMonths: number;
  securityDeposit: number;
  applyLeadDays: number;
  partnerName: string;
}

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
   * CHK_programme_page_settings_facts keeps the numbers non-negative; CHK_programme_page_settings_partner the name non-blank.
   */
  @Column({ type: 'integer', name: 'idealMonths', default: 6 }) idealMonths!: number;
  @Column({ type: 'integer', name: 'validityMonths', default: 12 }) validityMonths!: number;
  @Column({ type: 'integer', name: 'securityDeposit', default: 2000 }) securityDeposit!: number;
  @Column({ type: 'integer', name: 'applyLeadDays', default: 30 }) applyLeadDays!: number;
  @Column({ type: 'varchar', length: 150, name: 'partnerName', default: 'SUMAGO INFOTECH PVT LTD' }) partnerName!: string;
  /* Unpublishing hides the managed content from the public API; the website then shows its own copy. */
  @Column({ type: 'boolean', name: 'isPublished', default: true }) isPublished!: boolean;
}
