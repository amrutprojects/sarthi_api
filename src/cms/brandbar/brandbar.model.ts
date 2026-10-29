import { Column, Entity } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/*
 * The bar under the Top Bar on every website page (the "Brand Bar"): the programme's title and the
 * organisation's full name on the left, and the implementation partner on the right. A singleton.
 *
 * The title is required. The two full-name lines are printed one above the other in every language,
 * so each is optional on its own (blank: the line is left out). The partner label is blank in both
 * languages or filled in both, and a blank partner name leaves the whole partner block out.
 */
@Entity({ name: 'brand_bar_settings' })
export class BrandBarSettings extends AppBaseEntity {
  @Column({ type: 'varchar', length: 60, name: 'title' })
  title!: string;

  @Column({ type: 'varchar', length: 160, name: 'fullNameMr', default: '' })
  fullNameMr!: string;

  @Column({ type: 'varchar', length: 160, name: 'fullNameEn', default: '' })
  fullNameEn!: string;

  @Column({ type: 'varchar', length: 60, name: 'partnerLabelMr', default: '' })
  partnerLabelMr!: string;

  @Column({ type: 'varchar', length: 60, name: 'partnerLabelEn', default: '' })
  partnerLabelEn!: string;

  @Column({ type: 'varchar', length: 100, name: 'partnerName', default: '' })
  partnerName!: string;
}
