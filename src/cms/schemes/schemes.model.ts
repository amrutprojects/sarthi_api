import { Column, Entity } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/*
 * The "AMRUT Schemes" section (अमृत योजना विभाग) of the home page: its heading, subtitle, the default
 * label of each card's button, and whether the section is shown at all. A singleton — the schemes are
 * rows of AmrutScheme, so the section's own words are edited without touching any.
 */
@Entity({ name: 'amrut_schemes_section' })
export class AmrutSchemesSection extends AppBaseEntity {
  @Column({ type: 'varchar', length: 120, name: 'headingMr' })
  headingMr!: string;

  @Column({ type: 'varchar', length: 120, name: 'headingEn' })
  headingEn!: string;

  @Column({ type: 'varchar', length: 300, name: 'subtitleMr', default: '' })
  subtitleMr!: string;

  @Column({ type: 'varchar', length: 300, name: 'subtitleEn', default: '' })
  subtitleEn!: string;

  /* "अधिक जाणून घ्या" — printed on every card whose button has no label of its own. */
  @Column({ type: 'varchar', length: 60, name: 'buttonLabelMr' })
  buttonLabelMr!: string;

  @Column({ type: 'varchar', length: 60, name: 'buttonLabelEn' })
  buttonLabelEn!: string;

  @Column({ type: 'boolean', name: 'showSection', default: true })
  showSection!: boolean;
}

/*
 * One scheme card.
 *
 * `deadline` is the scheme's last date as a calendar date ('2027-03-31'), with no time and no time
 * zone, so it reads the same wherever it is printed; null when the scheme has none. An expired scheme
 * is NOT hidden or deleted by anything — it stays on the website until an administrator changes it,
 * as the bundled cards always did.
 *
 * `badge` is the small tag above the title ("हा कार्यक्रम" / "This programme"); blank in both
 * languages means no tag. `featured` gives the card the highlighted (saffron) style. `link` is where
 * the button goes — a page of this site ('/programme') or a full http(s) address — or null, in which
 * case the button says the page is not available yet, as the unlinked cards always have.
 * `buttonLabel` overrides the section's default label; blank in both languages means "use the default".
 */
@Entity({ name: 'amrut_schemes' })
export class AmrutScheme extends AppBaseEntity {
  @Column({ type: 'varchar', length: 150, name: 'titleMr' })
  titleMr!: string;

  @Column({ type: 'varchar', length: 150, name: 'titleEn' })
  titleEn!: string;

  @Column({ type: 'varchar', length: 500, name: 'descriptionMr' })
  descriptionMr!: string;

  @Column({ type: 'varchar', length: 500, name: 'descriptionEn' })
  descriptionEn!: string;

  @Column({ type: 'varchar', length: 40, name: 'badgeMr', default: '' })
  badgeMr!: string;

  @Column({ type: 'varchar', length: 40, name: 'badgeEn', default: '' })
  badgeEn!: string;

  /* A PostgreSQL date, which TypeORM reads back as the string 'YYYY-MM-DD' — never a Date, so no time zone shift. */
  @Column({ type: 'date', name: 'deadline', nullable: true })
  deadline!: string | null;

  @Column({ type: 'varchar', length: 500, name: 'link', nullable: true })
  link!: string | null;

  @Column({ type: 'varchar', length: 60, name: 'buttonLabelMr', default: '' })
  buttonLabelMr!: string;

  @Column({ type: 'varchar', length: 60, name: 'buttonLabelEn', default: '' })
  buttonLabelEn!: string;

  @Column({ type: 'boolean', name: 'featured', default: false })
  featured!: boolean;

  @Column({ type: 'integer', name: 'displayOrder', default: 0 })
  displayOrder!: number;
}
