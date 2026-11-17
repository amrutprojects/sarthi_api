import { Column, Entity } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/*
 * The "Quick actions" strip under the home page hero: whether it is shown. A singleton — the tiles
 * are rows of QuickAction — whose one setting is written only by the "Show on website" switch
 * (src/cms/visibility); there is no settings screen of its own.
 */
@Entity({ name: 'quick_action_settings' })
export class QuickActionSettings extends AppBaseEntity {
  /* The whole strip. Written only by the "Show on website" switch (src/cms/visibility). */
  @Column({ type: 'boolean', name: 'showSection', default: true })
  showSection!: boolean;
}

/*
 * One tile of the strip ("Apply Now", "Check Application Status").
 *
 * `title` is the bold text in both languages and is never blank. `subtitle` is the small line under
 * it: optional, blank in both languages (the line is left out) or filled in both. `icon` is one of
 * QUICK_ACTION_ICONS. `link` is where the tile goes — a page of this site ('/apply') or a full
 * http(s) address — and is required: a tile without a destination is meaningless.
 */
@Entity({ name: 'quick_actions' })
export class QuickAction extends AppBaseEntity {
  @Column({ type: 'varchar', length: 40, name: 'titleMr' })
  titleMr!: string;

  @Column({ type: 'varchar', length: 40, name: 'titleEn' })
  titleEn!: string;

  @Column({ type: 'varchar', length: 60, name: 'subtitleMr', default: '' })
  subtitleMr!: string;

  @Column({ type: 'varchar', length: 60, name: 'subtitleEn', default: '' })
  subtitleEn!: string;

  @Column({ type: 'varchar', length: 30, name: 'icon' })
  icon!: string;

  @Column({ type: 'varchar', length: 500, name: 'link' })
  link!: string;

  @Column({ type: 'integer', name: 'displayOrder', default: 0 })
  displayOrder!: number;
}
