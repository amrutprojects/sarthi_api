import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { AppBaseEntity } from '../../entities/base.entity';

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
