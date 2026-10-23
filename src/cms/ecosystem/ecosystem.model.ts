import { Column, Entity } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/*
 * The "AMRUT Ecosystem" section (अमृत प्रणाली) of the home and About pages: its heading, subtitle,
 * the default label of each card's link, and whether the section is shown at all. A singleton — the
 * cards are rows of EcosystemProgramme, so the section's own words are edited without touching any.
 */
@Entity({ name: 'ecosystem_section' })
export class EcosystemSection extends AppBaseEntity {
  @Column({ type: 'varchar', length: 120, name: 'headingMr' })
  headingMr!: string;

  @Column({ type: 'varchar', length: 120, name: 'headingEn' })
  headingEn!: string;

  @Column({ type: 'varchar', length: 300, name: 'subtitleMr', default: '' })
  subtitleMr!: string;

  @Column({ type: 'varchar', length: 300, name: 'subtitleEn', default: '' })
  subtitleEn!: string;

  /* "अधिक जाणून घ्या →" — printed on every card that has no label of its own. */
  @Column({ type: 'varchar', length: 60, name: 'linkLabelMr' })
  linkLabelMr!: string;

  @Column({ type: 'varchar', length: 60, name: 'linkLabelEn' })
  linkLabelEn!: string;

  @Column({ type: 'boolean', name: 'showSection', default: true })
  showSection!: boolean;
}

/*
 * One card: an AMRUT department or initiative.
 *
 * `icon` is one of ECOSYSTEM_ICONS. `link` is where the card goes — a page of this site ('/programme')
 * or a full http(s) address — or null, in which case the card says the page is not available yet,
 * as the unlinked cards always have. A card with a link is the highlighted ("live") card style.
 * `linkLabel` overrides the section's default label; blank in both languages means "use the default".
 */
@Entity({ name: 'ecosystem_programmes' })
export class EcosystemProgramme extends AppBaseEntity {
  @Column({ type: 'varchar', length: 80, name: 'nameMr' })
  nameMr!: string;

  @Column({ type: 'varchar', length: 80, name: 'nameEn' })
  nameEn!: string;

  @Column({ type: 'varchar', length: 200, name: 'descriptionMr' })
  descriptionMr!: string;

  @Column({ type: 'varchar', length: 200, name: 'descriptionEn' })
  descriptionEn!: string;

  @Column({ type: 'varchar', length: 30, name: 'icon' })
  icon!: string;

  @Column({ type: 'varchar', length: 500, name: 'link', nullable: true })
  link!: string | null;

  @Column({ type: 'varchar', length: 60, name: 'linkLabelMr', default: '' })
  linkLabelMr!: string;

  @Column({ type: 'varchar', length: 60, name: 'linkLabelEn', default: '' })
  linkLabelEn!: string;

  @Column({ type: 'integer', name: 'displayOrder', default: 0 })
  displayOrder!: number;
}
