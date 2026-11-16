import { Column, Entity } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/*
 * The strip at the very top of every website page (the "Top Bar"): the bold government name on the
 * left, and whether the language switch on the right is shown. A singleton — the links beside the
 * name are rows of TopBarLink, so the name is edited without touching any.
 *
 * The government name is optional: blank in both languages means the bold text is not shown.
 */
@Entity({ name: 'top_bar_settings' })
export class TopBarSettings extends AppBaseEntity {
  @Column({ type: 'varchar', length: 80, name: 'governmentNameMr', default: '' })
  governmentNameMr!: string;

  @Column({ type: 'varchar', length: 80, name: 'governmentNameEn', default: '' })
  governmentNameEn!: string;

  @Column({ type: 'boolean', name: 'showLanguageToggle', default: true })
  showLanguageToggle!: boolean;

  /* The whole strip (the language switch included). Written only by the "Show on website" switch (src/cms/visibility). */
  @Column({ type: 'boolean', name: 'showSection', default: true })
  showSection!: boolean;
}

/*
 * One link in the Top Bar ("Verify Certificate", "Check Application Status").
 *
 * `label` is the text of the link in both languages. `link` is where it goes — a page of this site
 * ('/verify') or a full http(s) address — and is required: a link without a destination is
 * meaningless.
 */
@Entity({ name: 'top_bar_links' })
export class TopBarLink extends AppBaseEntity {
  @Column({ type: 'varchar', length: 40, name: 'labelMr' })
  labelMr!: string;

  @Column({ type: 'varchar', length: 40, name: 'labelEn' })
  labelEn!: string;

  @Column({ type: 'varchar', length: 500, name: 'link' })
  link!: string;

  @Column({ type: 'integer', name: 'displayOrder', default: 0 })
  displayOrder!: number;
}
