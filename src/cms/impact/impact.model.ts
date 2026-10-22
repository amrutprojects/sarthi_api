import { Column, Entity } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/*
 * The "AMRUT's Impact" section (अमृतचा प्रभाव) of the home page: its heading and whether the section is
 * shown at all. A singleton — the figures are rows of ImpactStat, so the heading is edited without
 * touching any of them.
 */
@Entity({ name: 'impact_section' })
export class ImpactSection extends AppBaseEntity {
  @Column({ type: 'varchar', length: 120, name: 'headingMr' })
  headingMr!: string;

  @Column({ type: 'varchar', length: 120, name: 'headingEn' })
  headingEn!: string;

  @Column({ type: 'boolean', name: 'showSection', default: true })
  showSection!: boolean;
}

/*
 * One statistic card: the figure ('1,000+', '36') and what it counts, in both languages.
 *
 * `value` is text, not a number: it is printed exactly as entered, with its own grouping and suffix.
 * Every figure is entered by hand — none is counted from another table — so "Schemes running" does not
 * follow the AMRUT Schemes list; an administrator updates it when schemes are added or removed.
 */
@Entity({ name: 'impact_stats' })
export class ImpactStat extends AppBaseEntity {
  @Column({ type: 'varchar', length: 20, name: 'value' })
  value!: string;

  @Column({ type: 'varchar', length: 80, name: 'labelMr' })
  labelMr!: string;

  @Column({ type: 'varchar', length: 80, name: 'labelEn' })
  labelEn!: string;

  @Column({ type: 'integer', name: 'displayOrder' })
  displayOrder!: number;
}
