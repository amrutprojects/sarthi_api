import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/*
 * The Modules page of the AMRUT Kalash programme.
 *
 * The business rules these tables hold, which is what their shapes are for:
 *
 * - The diploma is FOUR modules of 120 hours each — 480 in total.
 * - Each module's hours split into training and assessment; training runs
 *   weeksPerModule × daysPerWeek × hoursPerDay, assessment weeklyAssessmentHours a week. The two
 *   parts must add up to the module total, which CHK_programme_module_settings_hours enforces.
 * - Modules 1 (ECS) and 2 (ITS) are core and identical for every candidate.
 * - Modules 3 (DS-BDS) and 4 (DS-ADS) are ELECTIVE: the candidate picks one of the employment
 *   domains that module offers, and earns that module's certificate in it.
 *
 * Each elective module carries its OWN list of domains, which is why they hang off
 * programme_modules rather than off the settings row. Module 3 and module 4 happen to offer the
 * same ten domains today, but they are two independent lists: adding a domain to one does not add
 * it to the other, and either can offer something the other does not.
 */

/*
 * The page's single-valued numbers, and its publication state. A singleton, enforced the same way
 * the Contact page and footer are: a unique index on a constant expression.
 */
@Entity({ name: 'programme_module_settings' })
export class ProgrammeModuleSettings extends AppBaseEntity {
  @Column({ type: 'integer', name: 'moduleHours' })
  moduleHours!: number;

  @Column({ type: 'integer', name: 'trainingHours' })
  trainingHours!: number;

  @Column({ type: 'integer', name: 'assessmentHours' })
  assessmentHours!: number;

  @Column({ type: 'integer', name: 'weeksPerModule' })
  weeksPerModule!: number;

  @Column({ type: 'integer', name: 'daysPerWeek' })
  daysPerWeek!: number;

  @Column({ type: 'integer', name: 'hoursPerDay' })
  hoursPerDay!: number;

  /* Fractional — the programme runs 3.5 assessment hours a week. */
  @Column({ type: 'numeric', precision: 4, scale: 1, name: 'weeklyAssessmentHours' })
  weeklyAssessmentHours!: string;

  /* The donut in the middle of the Learning path card: "1 hr" / "per session". */
  @Column({ type: 'varchar', length: 40, name: 'sessionLengthMr' })
  sessionLengthMr!: string;

  @Column({ type: 'varchar', length: 40, name: 'sessionLengthEn' })
  sessionLengthEn!: string;

  @Column({ type: 'varchar', length: 80, name: 'sessionLabelMr' })
  sessionLabelMr!: string;

  @Column({ type: 'varchar', length: 80, name: 'sessionLabelEn' })
  sessionLabelEn!: string;

  /* The two shares of the donut. They must total 100 — CHK_programme_module_settings_path. */
  @Column({ type: 'integer', name: 'fixedPathPct' })
  fixedPathPct!: number;

  @Column({ type: 'integer', name: 'selfPathPct' })
  selfPathPct!: number;

  @Column({ type: 'boolean', name: 'isPublished', default: true })
  isPublished!: boolean;

  @OneToMany('ProgrammeModule', (m: ProgrammeModule) => m.settings)
  modules!: ProgrammeModule[];
}

/* One module card. `isElective` is what makes the card open the domain list on the public site. */
@Entity({ name: 'programme_modules' })
@Index('IDX_programme_modules_settingsId', ['settingsId'])
export class ProgrammeModule extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'settingsId' })
  settingsId!: string;

  /* The number shown in the card's badge. */
  @Column({ type: 'integer', name: 'no' })
  no!: number;

  /* ECS, ITS, DS-BDS, DS-ADS. Unique among live modules — UQ_programme_modules_code. */
  @Column({ type: 'varchar', length: 32, name: 'code' })
  code!: string;

  /* The full certificate name. */
  @Column({ type: 'varchar', length: 300, name: 'nameMr' })
  nameMr!: string;

  @Column({ type: 'varchar', length: 300, name: 'nameEn' })
  nameEn!: string;

  @Column({ type: 'varchar', length: 600, name: 'descriptionMr' })
  descriptionMr!: string;

  @Column({ type: 'varchar', length: 600, name: 'descriptionEn' })
  descriptionEn!: string;

  /* True for the two modules that carry the domain choice. */
  @Column({ type: 'boolean', name: 'isElective', default: false })
  isElective!: boolean;

  @Column({ type: 'integer', name: 'displayOrder', default: 0 })
  displayOrder!: number;

  @ManyToOne('ProgrammeModuleSettings', (s: ProgrammeModuleSettings) => s.modules, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'settingsId' })
  settings!: ProgrammeModuleSettings;

  @OneToMany('ProgrammeElectiveDomain', (d: ProgrammeElectiveDomain) => d.module)
  electives!: ProgrammeElectiveDomain[];
}

/*
 * One employment domain offered BY ONE MODULE, and the certificate that module awards in it.
 *
 * The row hangs off the module rather than off the page: each elective module carries its own list,
 * so module 3 and module 4 can offer different domains, and adding a domain to one does not add it
 * to the other. The certificate is single, because it is this module's award in this domain — the
 * module the row belongs to is what makes it the basic or the advanced one.
 *
 * Course titles are published in English only, as the programme publishes them.
 */
@Entity({ name: 'programme_elective_domains' })
@Index('IDX_programme_elective_domains_moduleId', ['moduleId'])
export class ProgrammeElectiveDomain extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'moduleId' })
  moduleId!: string;

  /* The number shown in this module's domain table. Unique within the module. */
  @Column({ type: 'integer', name: 'no' })
  no!: number;

  @Column({ type: 'varchar', length: 200, name: 'domainMr' })
  domainMr!: string;

  @Column({ type: 'varchar', length: 200, name: 'domainEn' })
  domainEn!: string;

  /* What a candidate who picks this domain earns in this module. */
  @Column({ type: 'varchar', length: 300, name: 'certificate' })
  certificate!: string;

  @Column({ type: 'integer', name: 'displayOrder', default: 0 })
  displayOrder!: number;

  @ManyToOne('ProgrammeModule', (m: ProgrammeModule) => m.electives, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'moduleId' })
  module!: ProgrammeModule;
}
