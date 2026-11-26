import { Column, Entity } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/*
 * The "Sarthi Advisory Committee" page (सारथी सल्लागार समिती): its heading and subtitle. A
 * singleton — the trainers and advisors are rows of AdvisoryMember, so the page's own words can be
 * edited without touching any member.
 *
 * Optional text is '' when absent, never null, and blank in both languages or filled in both (see
 * the migration's CHECKs).
 */
@Entity({ name: 'advisory_section' })
export class AdvisorySection extends AppBaseEntity {
  @Column({ type: 'varchar', length: 150, name: 'headingMr' })
  headingMr!: string;

  @Column({ type: 'varchar', length: 150, name: 'headingEn' })
  headingEn!: string;

  @Column({ type: 'varchar', length: 300, name: 'subtitleMr', default: '' })
  subtitleMr!: string;

  @Column({ type: 'varchar', length: 300, name: 'subtitleEn', default: '' })
  subtitleEn!: string;
}

/*
 * One trainer or advisor on the committee.
 *
 * Unlike a board member, the name is always known (the administrator adds people by name), so it is
 * required in both languages. The position is an optional pair (both languages or neither).
 *
 * The profile behind the website's "View Profile" button — the experience paragraph and the five
 * lists — may be filled in either language, both or neither: long biographies often exist in one
 * language only, and the website falls back to the other. Each list is stored as its items one per
 * line ('' when empty); the API hands them out as arrays (see advisory.service.ts).
 *
 * `photoKey` is where the photo is kept in the document storage ('cms/advisory-committee/<uuid>.jpg').
 * Every upload gets a new key, so a replaced photo never reuses an old URL and can be cached freely.
 */
@Entity({ name: 'advisory_members' })
export class AdvisoryMember extends AppBaseEntity {
  @Column({ type: 'varchar', length: 120, name: 'nameMr' })
  nameMr!: string;

  @Column({ type: 'varchar', length: 120, name: 'nameEn' })
  nameEn!: string;

  /* The position line — "Vice Chancellor, COEP Technological University, Pune". */
  @Column({ type: 'varchar', length: 300, name: 'designationMr', default: '' })
  designationMr!: string;

  @Column({ type: 'varchar', length: 300, name: 'designationEn', default: '' })
  designationEn!: string;

  /* One paragraph. */
  @Column({ type: 'varchar', length: 1000, name: 'experienceMr', default: '' })
  experienceMr!: string;

  @Column({ type: 'varchar', length: 1000, name: 'experienceEn', default: '' })
  experienceEn!: string;

  @Column({ type: 'text', name: 'administrativeRolesMr', default: '' })
  administrativeRolesMr!: string;

  @Column({ type: 'text', name: 'administrativeRolesEn', default: '' })
  administrativeRolesEn!: string;

  @Column({ type: 'text', name: 'keyAchievementsMr', default: '' })
  keyAchievementsMr!: string;

  @Column({ type: 'text', name: 'keyAchievementsEn', default: '' })
  keyAchievementsEn!: string;

  @Column({ type: 'text', name: 'majorContributionsMr', default: '' })
  majorContributionsMr!: string;

  @Column({ type: 'text', name: 'majorContributionsEn', default: '' })
  majorContributionsEn!: string;

  @Column({ type: 'text', name: 'researchLeadershipMr', default: '' })
  researchLeadershipMr!: string;

  @Column({ type: 'text', name: 'researchLeadershipEn', default: '' })
  researchLeadershipEn!: string;

  @Column({ type: 'text', name: 'educationMr', default: '' })
  educationMr!: string;

  @Column({ type: 'text', name: 'educationEn', default: '' })
  educationEn!: string;

  @Column({ type: 'varchar', length: 120, name: 'photoKey', nullable: true })
  photoKey!: string | null;

  @Column({ type: 'integer', name: 'displayOrder', default: 0 })
  displayOrder!: number;

  /*
   * The heading the website lists this member under (AdvisoryGroup); null for none. Kept as a plain
   * id: groups are few, so the service maps them in memory rather than joining.
   */
  @Column({ type: 'uuid', name: 'groupId', nullable: true })
  groupId!: string | null;
}

/*
 * A heading the website lists members under — usually the organisation they belong to, e.g.
 * "ACADEMY OF MAHARASHTRA RESEARCH, UPLIFTMENT AND TRAINING (AMRUT)". Printed for every visitor, so the
 * name is required in both languages. `isActive` = shown on the website: a hidden group hides its
 * heading and its members. Members keep their own display order; groups are ordered among themselves.
 */
@Entity({ name: 'advisory_groups' })
export class AdvisoryGroup extends AppBaseEntity {
  @Column({ type: 'varchar', length: 200, name: 'nameMr' })
  nameMr!: string;

  @Column({ type: 'varchar', length: 200, name: 'nameEn' })
  nameEn!: string;

  @Column({ type: 'integer', name: 'displayOrder', default: 0 })
  displayOrder!: number;
}
