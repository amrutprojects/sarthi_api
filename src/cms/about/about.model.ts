import { Column, Entity } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/*
 * The "About AMRUT" section (अमृत विषयी माहिती): its heading, optional subtitle, the main description
 * and whether it is shown. A singleton — the information rows and the cards are rows of their own
 * tables, so each can be added to without touching the rest.
 */
@Entity({ name: 'about_section' })
export class AboutSection extends AppBaseEntity {
  @Column({ type: 'varchar', length: 120, name: 'headingMr' })
  headingMr!: string;

  @Column({ type: 'varchar', length: 120, name: 'headingEn' })
  headingEn!: string;

  @Column({ type: 'varchar', length: 300, name: 'subtitleMr', default: '' })
  subtitleMr!: string;

  @Column({ type: 'varchar', length: 300, name: 'subtitleEn', default: '' })
  subtitleEn!: string;

  /* The paragraph at the top of the information card. Plain text; line breaks are kept. */
  @Column({ type: 'varchar', length: 4000, name: 'descriptionMr' })
  descriptionMr!: string;

  @Column({ type: 'varchar', length: 4000, name: 'descriptionEn' })
  descriptionEn!: string;

  @Column({ type: 'boolean', name: 'showSection', default: true })
  showSection!: boolean;
}

/* One row of the information card: "Established — By Government Resolution dated 22 August 2019". */
@Entity({ name: 'about_facts' })
export class AboutFact extends AppBaseEntity {
  @Column({ type: 'varchar', length: 80, name: 'labelMr' })
  labelMr!: string;

  @Column({ type: 'varchar', length: 80, name: 'labelEn' })
  labelEn!: string;

  @Column({ type: 'varchar', length: 500, name: 'valueMr' })
  valueMr!: string;

  @Column({ type: 'varchar', length: 500, name: 'valueEn' })
  valueEn!: string;

  @Column({ type: 'integer', name: 'displayOrder', default: 0 })
  displayOrder!: number;
}

/*
 * One card beside the information card: "Our Mission", "Our Vision", "Our Values", or any card an
 * administrator adds. `isRequired` marks the original three: they can be edited and reordered but
 * never deleted or hidden (see the CHECK in the migration). It is set by the seed, never by a request.
 */
@Entity({ name: 'about_cards' })
export class AboutCard extends AppBaseEntity {
  @Column({ type: 'varchar', length: 80, name: 'headingMr' })
  headingMr!: string;

  @Column({ type: 'varchar', length: 80, name: 'headingEn' })
  headingEn!: string;

  @Column({ type: 'varchar', length: 1000, name: 'descriptionMr' })
  descriptionMr!: string;

  @Column({ type: 'varchar', length: 1000, name: 'descriptionEn' })
  descriptionEn!: string;

  @Column({ type: 'integer', name: 'displayOrder', default: 0 })
  displayOrder!: number;

  @Column({ type: 'boolean', name: 'isRequired', default: false })
  isRequired!: boolean;
}
