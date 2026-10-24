import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryColumn } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { District } from '../masters/district/district.model';

/* The two cards the Contact page shows today. New card types are added here and to the CHECK constraint. */
export const ORG_TYPES = ['AMRUT', 'IMPLEMENTATION_PARTNER'] as const;
export type OrgType = (typeof ORG_TYPES)[number];

/*
 * Contact page banner and publication state. A singleton: the database admits exactly one
 * non-deleted row (UQ_contact_page_settings_singleton, a unique index on a constant expression).
 *
 * Every piece of prose is stored twice, Marathi and English, because the public site defaults to
 * Marathi and renders these through bi(). The service never falls back from one language to the
 * other — both are required, so an admin cannot half-translate the page by accident.
 */
@Entity({ name: 'contact_page_settings' })
export class ContactPageSettings extends AppBaseEntity {
  @Column({ type: 'varchar', length: 150, name: 'pageTitleMr' })
  pageTitleMr!: string;

  @Column({ type: 'varchar', length: 150, name: 'pageTitleEn' })
  pageTitleEn!: string;

  @Column({ type: 'varchar', length: 300, name: 'pageSubtitleMr' })
  pageSubtitleMr!: string;

  @Column({ type: 'varchar', length: 300, name: 'pageSubtitleEn' })
  pageSubtitleEn!: string;

  /* Unpublishing hides the managed content from the public API; the website then shows its own copy. */
  @Column({ type: 'boolean', name: 'isPublished', default: true })
  isPublished!: boolean;

  @OneToMany('ContactOrganization', (o: ContactOrganization) => o.settings)
  organizations!: ContactOrganization[];
}

/*
 * One card on the Contact page. Which columns apply depends on orgType, and the database enforces
 * that with CHK_contact_organizations_required_by_type rather than with NOT NULL:
 *   AMRUT                  — address, email, phone (website optional)
 *   IMPLEMENTATION_PARTNER — role, email, helpdesk hours
 */
@Entity({ name: 'contact_organizations' })
@Index('UQ_contact_organizations_type_active', ['settingsId', 'orgType'], { unique: true, where: '"isDelete" = false' })
@Index('IDX_contact_organizations_settingsId', ['settingsId'])
export class ContactOrganization extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'settingsId' })
  settingsId!: string;

  @Column({ type: 'varchar', length: 32, name: 'orgType' })
  orgType!: OrgType;

  @Column({ type: 'varchar', length: 150, name: 'nameMr' })
  nameMr!: string;

  @Column({ type: 'varchar', length: 150, name: 'nameEn' })
  nameEn!: string;

  @Column({ type: 'varchar', length: 200, name: 'roleMr', nullable: true })
  roleMr!: string | null;

  @Column({ type: 'varchar', length: 200, name: 'roleEn', nullable: true })
  roleEn!: string | null;

  @Column({ type: 'varchar', length: 500, name: 'addressMr', nullable: true })
  addressMr!: string | null;

  @Column({ type: 'varchar', length: 500, name: 'addressEn', nullable: true })
  addressEn!: string | null;

  /* Always stored lower-cased (CHK_contact_organizations_email). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'websiteUrl', nullable: true })
  websiteUrl!: string | null;

  @Column({ type: 'varchar', length: 120, name: 'helpdeskHoursMr', nullable: true })
  helpdeskHoursMr!: string | null;

  @Column({ type: 'varchar', length: 120, name: 'helpdeskHoursEn', nullable: true })
  helpdeskHoursEn!: string | null;

  @Column({ type: 'integer', name: 'displayOrder', default: 0 })
  displayOrder!: number;

  @ManyToOne('ContactPageSettings', (s: ContactPageSettings) => s.organizations, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'settingsId' })
  settings!: ContactPageSettings;
}

/*
 * A district / cluster coordinator card. People's names are shown as-is in both languages, so the
 * name is a single column. The districts it covers live in contact_coordinator_districts.
 */
@Entity({ name: 'contact_coordinators' })
@Index('IDX_contact_coordinators_settingsId', ['settingsId'])
export class ContactCoordinator extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'settingsId' })
  settingsId!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 32 })
  phone!: string;

  /* Always stored lower-cased (CHK_contact_coordinators_email). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @Column({ type: 'integer', name: 'displayOrder', default: 0 })
  displayOrder!: number;

  @OneToMany('ContactCoordinatorDistrict', (d: ContactCoordinatorDistrict) => d.coordinator)
  districts!: ContactCoordinatorDistrict[];
}

/* One district covered by a coordinator. A district belongs to at most one coordinator. */
@Entity({ name: 'contact_coordinator_districts' })
export class ContactCoordinatorDistrict {
  @PrimaryColumn({ type: 'uuid', name: 'coordinatorId' })
  coordinatorId!: string;

  @PrimaryColumn({ type: 'uuid', name: 'districtId' })
  districtId!: string;

  /* Position on the coordinator's card: the saved order, lead district first. */
  @Column({ type: 'integer', name: 'displayOrder', default: 0 })
  displayOrder!: number;

  @ManyToOne('ContactCoordinator', (c: ContactCoordinator) => c.districts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'coordinatorId' })
  coordinator!: ContactCoordinator;

  @ManyToOne('District', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'districtId' })
  district!: District;
}

/*
 * Collectorate / District Office details for one district. Every field is optional: whatever is not
 * yet supplied is shown on the website as "to be supplied from official records".
 */
@Entity({ name: 'contact_district_offices' })
@Index('UQ_contact_district_offices_district_active', ['districtId'], { unique: true, where: '"isDelete" = false' })
export class ContactDistrictOffice extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'settingsId' })
  settingsId!: string;

  @Column({ type: 'uuid', name: 'districtId' })
  districtId!: string;

  @Column({ type: 'varchar', length: 150, name: 'collectorName', nullable: true })
  collectorName!: string | null;

  @Column({ type: 'varchar', length: 500, name: 'addressMr', nullable: true })
  addressMr!: string | null;

  @Column({ type: 'varchar', length: 500, name: 'addressEn', nullable: true })
  addressEn!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 120, name: 'officeHoursMr', nullable: true })
  officeHoursMr!: string | null;

  @Column({ type: 'varchar', length: 120, name: 'officeHoursEn', nullable: true })
  officeHoursEn!: string | null;

  @ManyToOne('District', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'districtId' })
  district!: District;
}
