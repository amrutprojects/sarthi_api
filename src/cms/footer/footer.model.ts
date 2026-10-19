import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/*
 * The site footer appears on every public page, so its shape is fixed by the stylesheet rather than
 * by the content: `.gov-foot-in` is a four-column grid (1.6fr 1fr 1fr 1.3fr) — an About column, two
 * link columns, a Contact column. An administrator edits what is IN those columns; a fifth column
 * would push the grid onto a second row and break the footer site-wide, which is why
 * MAX_LINK_COLUMNS is enforced here, in the validator and in the service.
 */
export const FOOTER_SECTION_KINDS = ['LINK_COLUMN', 'CONTACT'] as const;
export type FooterSectionKind = (typeof FOOTER_SECTION_KINDS)[number];

/*
 * How a footer line behaves, which decides the element the website renders:
 *   INTERNAL    — a route inside the site; href is an app path  → <Link>
 *   EXTERNAL    — an off-site link; href is http(s)             → <a target="_blank">
 *   TEXT        — a plain line, such as an address              → <div>
 *   UNAVAILABLE — in the design, no destination in this build   → <button> raising a notice
 */
export const FOOTER_LINK_KINDS = ['INTERNAL', 'EXTERNAL', 'TEXT', 'UNAVAILABLE'] as const;
export type FooterLinkKind = (typeof FOOTER_LINK_KINDS)[number];

/** Dictated by the four-column grid: About + 2 link columns + Contact. */
export const MAX_LINK_COLUMNS = 2;

/*
 * The footer's single-valued content, and its publication state. A singleton, enforced the same way
 * the Contact page is: UQ_footer_settings_singleton, a unique index on a constant expression that
 * admits exactly one non-deleted row.
 *
 * Every piece of prose is stored twice, Marathi and English, because the public site defaults to
 * Marathi and renders these through bi(). Language-neutral values — email, phone, the partner's
 * registered name — stay single-valued.
 */
@Entity({ name: 'footer_settings' })
export class FooterSettings extends AppBaseEntity {
  /* Column 1 — About. */
  @Column({ type: 'varchar', length: 200, name: 'aboutHeadingMr' })
  aboutHeadingMr!: string;

  @Column({ type: 'varchar', length: 200, name: 'aboutHeadingEn' })
  aboutHeadingEn!: string;

  /* The website truncates this at 320 characters so a long entry cannot stretch the column. */
  @Column({ type: 'text', name: 'aboutBodyMr' })
  aboutBodyMr!: string;

  @Column({ type: 'text', name: 'aboutBodyEn' })
  aboutBodyEn!: string;

  @Column({ type: 'varchar', length: 120, name: 'partnerLabelMr' })
  partnerLabelMr!: string;

  @Column({ type: 'varchar', length: 120, name: 'partnerLabelEn' })
  partnerLabelEn!: string;

  @Column({ type: 'varchar', length: 150, name: 'partnerName' })
  partnerName!: string;

  /* Column 4 — Contact. */
  @Column({ type: 'varchar', length: 200, name: 'contactHeadingMr' })
  contactHeadingMr!: string;

  @Column({ type: 'varchar', length: 200, name: 'contactHeadingEn' })
  contactHeadingEn!: string;

  @Column({ type: 'varchar', length: 500, name: 'contactAddressMr' })
  contactAddressMr!: string;

  @Column({ type: 'varchar', length: 500, name: 'contactAddressEn' })
  contactAddressEn!: string;

  /* Always stored lower-cased (CHK_footer_settings_email). */
  @Column({ type: 'varchar', length: 255, name: 'contactEmail' })
  contactEmail!: string;

  @Column({ type: 'varchar', length: 32, name: 'contactPhone' })
  contactPhone!: string;

  /* The bottom bar. `{year}` is substituted by the website so the copyright cannot go stale. */
  @Column({ type: 'varchar', length: 300, name: 'copyrightMr' })
  copyrightMr!: string;

  @Column({ type: 'varchar', length: 300, name: 'copyrightEn' })
  copyrightEn!: string;

  @Column({ type: 'varchar', length: 400, name: 'disclaimerMr' })
  disclaimerMr!: string;

  @Column({ type: 'varchar', length: 400, name: 'disclaimerEn' })
  disclaimerEn!: string;

  /* Unpublishing hides the managed footer; the website then shows its own bundled copy. */
  @Column({ type: 'boolean', name: 'isPublished', default: true })
  isPublished!: boolean;

  @OneToMany('FooterSection', (s: FooterSection) => s.settings)
  sections!: FooterSection[];
}

/*
 * A footer column that holds links.
 *
 * LINK_COLUMN rows are the two middle columns and carry their own heading. The single CONTACT row
 * is not a column of its own — the Contact column's heading, address, email and phone live on
 * FooterSettings — it exists only to own the extra lines an administrator adds beneath the phone
 * number, so that every link in the footer lives in one table.
 */
@Entity({ name: 'footer_sections' })
@Index('IDX_footer_sections_settingsId', ['settingsId'])
export class FooterSection extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'settingsId' })
  settingsId!: string;

  @Column({ type: 'varchar', length: 32, name: 'kind' })
  kind!: FooterSectionKind;

  /* Null for the CONTACT row, which takes its heading from FooterSettings. */
  @Column({ type: 'varchar', length: 200, name: 'headingMr', nullable: true })
  headingMr!: string | null;

  @Column({ type: 'varchar', length: 200, name: 'headingEn', nullable: true })
  headingEn!: string | null;

  @Column({ type: 'integer', name: 'displayOrder', default: 0 })
  displayOrder!: number;

  @ManyToOne('FooterSettings', (s: FooterSettings) => s.sections, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'settingsId' })
  settings!: FooterSettings;

  @OneToMany('FooterLink', (l: FooterLink) => l.section)
  links!: FooterLink[];
}

/*
 * One line in a footer column.
 *
 * `href` is required for INTERNAL and EXTERNAL and forbidden for TEXT and UNAVAILABLE, enforced by
 * CHK_footer_links_href_by_kind. The shape of a usable href is checked in the validator and again
 * on the website, because a stored `javascript:` URL would otherwise reach an href attribute.
 */
@Entity({ name: 'footer_links' })
@Index('IDX_footer_links_sectionId', ['sectionId'])
export class FooterLink extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'sectionId' })
  sectionId!: string;

  @Column({ type: 'varchar', length: 32, name: 'kind' })
  kind!: FooterLinkKind;

  @Column({ type: 'varchar', length: 150, name: 'labelMr' })
  labelMr!: string;

  @Column({ type: 'varchar', length: 150, name: 'labelEn' })
  labelEn!: string;

  @Column({ type: 'varchar', length: 500, name: 'href', nullable: true })
  href!: string | null;

  @Column({ type: 'integer', name: 'displayOrder', default: 0 })
  displayOrder!: number;

  @ManyToOne('FooterSection', (s: FooterSection) => s.links, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sectionId' })
  section!: FooterSection;
}
