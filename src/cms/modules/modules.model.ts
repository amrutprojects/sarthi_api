import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/*
 * The Modules page of the AMRUT Kalash programme.
 *
 * The business rules these tables hold, which is what their shapes are for:
 *
 * - Each module carries its OWN timetable: its total hours split into training and assessment,
 *   and the weeks, days and hours those run over. The two parts must add up to the module total,
 *   enforced per module by CHK_programme_modules_hours.
 * - A MAIN module runs for every candidate. An ELECTIVE is one the candidate picks an employment
 *   domain within.
 * - Every module carries its own list of domains, which is why they hang off programme_modules
 *   rather than off the settings row. Adding a domain to one does not add it to any other.
 *
 * The programme totals — total hours, the module count, the number of distinct domains — are NOT
 * stored. They are summed from the modules that are active, so they can never contradict them,
 * and switching an elective off removes it from both the site and the totals in one action.
 */

/*
 * MAIN runs for every candidate; ELECTIVE is one the candidate chooses a domain within. An
 * elective that is not active is neither shown on the site nor counted in the programme totals.
 */
export const MODULE_KINDS = ['MAIN', 'ELECTIVE'] as const;
export type ModuleKind = (typeof MODULE_KINDS)[number];

/*
 * The page's single-valued content, the programme fact sheet, and the publication state.
 * A singleton, enforced the same way the Contact page and footer are: a unique index on a
 * constant expression.
 */
@Entity({ name: 'programme_module_settings' })
export class ProgrammeModuleSettings extends AppBaseEntity {
  /* The /modules page heading. */
  @Column({ type: 'varchar', length: 200, name: 'pageTitleMr' })
  pageTitleMr!: string;

  @Column({ type: 'varchar', length: 200, name: 'pageTitleEn' })
  pageTitleEn!: string;

  @Column({ type: 'varchar', length: 500, name: 'pageSubtitleMr' })
  pageSubtitleMr!: string;

  @Column({ type: 'varchar', length: 500, name: 'pageSubtitleEn' })
  pageSubtitleEn!: string;

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

  /*
   * The programme fact sheet shown on /programme. Total hours and the elective count are not
   * here: they are summed from the modules, so they cannot contradict them.
   */
  @Column({ type: 'integer', name: 'idealMonths' })
  idealMonths!: number;

  @Column({ type: 'integer', name: 'validityMonths' })
  validityMonths!: number;

  @Column({ type: 'integer', name: 'securityDeposit' })
  securityDeposit!: number;

  @Column({ type: 'integer', name: 'applyLeadDays' })
  applyLeadDays!: number;

  @Column({ type: 'varchar', length: 150, name: 'partnerName' })
  partnerName!: string;

  /*
   * The district figure on the home page's "at a glance" card. Stored rather than derived: the
   * geography master holds the districts a FORM may choose from, which is a different thing.
   */
  @Column({ type: 'integer', name: 'districtCount', default: 36 })
  districtCount!: number;

  @Column({ type: 'boolean', name: 'isPublished', default: true })
  isPublished!: boolean;

  @OneToMany('ProgrammeModule', (m: ProgrammeModule) => m.settings)
  modules!: ProgrammeModule[];
}

/* One module card, with its own timetable and its own list of employment domains. */
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

  /* MAIN or ELECTIVE. Offered as a dropdown in the admin panel. */
  @Column({ type: 'varchar', length: 16, name: 'kind' })
  kind!: ModuleKind;

  /* The full certificate name. */
  @Column({ type: 'varchar', length: 300, name: 'nameMr' })
  nameMr!: string;

  @Column({ type: 'varchar', length: 300, name: 'nameEn' })
  nameEn!: string;

  @Column({ type: 'varchar', length: 600, name: 'descriptionMr' })
  descriptionMr!: string;

  @Column({ type: 'varchar', length: 600, name: 'descriptionEn' })
  descriptionEn!: string;

  /*
   * This module's own timetable. Each module carries its own, so one can run longer than another.
   * Training plus assessment must equal the total — CHK_programme_modules_hours.
   */
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
 * The row hangs off the module rather than off the page: each module carries its own list, so two
 * modules can offer different domains, and adding a domain to one does not add it to the other.
 * The certificate is single, because it is this module's award in this domain.
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
