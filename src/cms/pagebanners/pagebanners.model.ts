import { Column, Entity } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { PageBannerKey } from './pagebanners.types';

/*
 * The banner of one website page: its custom title and subtitle. At most one live row per key; a page
 * with no row (or with blank text) shows the website's default words.
 */
@Entity({ name: 'page_banners' })
export class PageBanner extends AppBaseEntity {
  @Column({ type: 'varchar', length: 20, name: 'key' })
  key!: PageBannerKey;

  /* Both blank: the website's default title (CHECK: both or neither). */
  @Column({ type: 'varchar', length: 150, name: 'titleMr', default: '' })
  titleMr!: string;

  @Column({ type: 'varchar', length: 150, name: 'titleEn', default: '' })
  titleEn!: string;

  /* Both blank: the website's default subtitle (CHECK: both or neither). */
  @Column({ type: 'varchar', length: 300, name: 'subtitleMr', default: '' })
  subtitleMr!: string;

  @Column({ type: 'varchar', length: 300, name: 'subtitleEn', default: '' })
  subtitleEn!: string;
}
