import { Column, Entity } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/*
 * The announcement ticker (सूचना) at the very top of every website page: its label (the small pill on
 * the left of the strip) and whether the strip is shown at all. A singleton — the announcements are
 * rows of Announcement, so the label is edited without touching any.
 */
@Entity({ name: 'announcement_settings' })
export class AnnouncementSettings extends AppBaseEntity {
  @Column({ type: 'varchar', length: 60, name: 'labelMr' })
  labelMr!: string;

  @Column({ type: 'varchar', length: 60, name: 'labelEn' })
  labelEn!: string;

  @Column({ type: 'boolean', name: 'showSection', default: true })
  showSection!: boolean;
}

/*
 * One announcement scrolling across the ticker.
 *
 * `title` is printed in bold; `detail` follows it after a dash, and is blank in both languages when
 * the announcement has none. `link` makes the whole announcement clickable — a page of this site
 * ('/apply') or a full http(s) address — or is null, in which case it is plain text.
 */
@Entity({ name: 'announcements' })
export class Announcement extends AppBaseEntity {
  @Column({ type: 'varchar', length: 200, name: 'titleMr' })
  titleMr!: string;

  @Column({ type: 'varchar', length: 200, name: 'titleEn' })
  titleEn!: string;

  @Column({ type: 'varchar', length: 500, name: 'detailMr', default: '' })
  detailMr!: string;

  @Column({ type: 'varchar', length: 500, name: 'detailEn', default: '' })
  detailEn!: string;

  @Column({ type: 'varchar', length: 500, name: 'link', nullable: true })
  link!: string | null;

  @Column({ type: 'integer', name: 'displayOrder', default: 0 })
  displayOrder!: number;
}
