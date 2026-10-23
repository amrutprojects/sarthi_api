import { Column, Entity } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/*
 * The "Leadership & Governing Board" section (मान्यवर व संचालक मंडळ): its heading, subtitle and the
 * notice under the cards. A singleton — the member cards are rows of BoardMember, so the section's
 * own words can be edited without touching any member.
 *
 * Optional text is '' when absent, never null, and blank in both languages or filled in both (see
 * the migration's CHECKs).
 */
@Entity({ name: 'board_section' })
export class BoardSection extends AppBaseEntity {
  @Column({ type: 'varchar', length: 150, name: 'headingMr' })
  headingMr!: string;

  @Column({ type: 'varchar', length: 150, name: 'headingEn' })
  headingEn!: string;

  @Column({ type: 'varchar', length: 300, name: 'subtitleMr', default: '' })
  subtitleMr!: string;

  @Column({ type: 'varchar', length: 300, name: 'subtitleEn', default: '' })
  subtitleEn!: string;

  @Column({ type: 'varchar', length: 150, name: 'noticeTitleMr', default: '' })
  noticeTitleMr!: string;

  @Column({ type: 'varchar', length: 150, name: 'noticeTitleEn', default: '' })
  noticeTitleEn!: string;

  @Column({ type: 'varchar', length: 1000, name: 'noticeBodyMr', default: '' })
  noticeBodyMr!: string;

  @Column({ type: 'varchar', length: 1000, name: 'noticeBodyEn', default: '' })
  noticeBodyEn!: string;

  /* Whether the notice box under the cards is printed. Its text is kept while it is hidden. */
  @Column({ type: 'boolean', name: 'showNotice', default: true })
  showNotice!: boolean;
}

/*
 * One card of the section.
 *
 * `name` is null while the officeholder's name is still to be supplied from official records; the
 * website prints its "name to be filled" placeholder for it rather than a guessed name.
 *
 * `photoKey` is where the photo is kept in the document storage ('cms/board-members/<uuid>.jpg').
 * Every upload gets a new key, so a replaced photo never reuses an old URL and can be cached freely.
 */
@Entity({ name: 'board_members' })
export class BoardMember extends AppBaseEntity {
  @Column({ type: 'varchar', length: 120, name: 'name', nullable: true })
  name!: string | null;

  /* The badge above the name — "राज्य शासन" / "State Government". */
  @Column({ type: 'varchar', length: 60, name: 'categoryMr' })
  categoryMr!: string;

  @Column({ type: 'varchar', length: 60, name: 'categoryEn' })
  categoryEn!: string;

  /* The office held, printed under the name. */
  @Column({ type: 'varchar', length: 250, name: 'designationMr' })
  designationMr!: string;

  @Column({ type: 'varchar', length: 250, name: 'designationEn' })
  designationEn!: string;

  /* The short italic line at the foot of the card. */
  @Column({ type: 'varchar', length: 500, name: 'descriptionMr', default: '' })
  descriptionMr!: string;

  @Column({ type: 'varchar', length: 500, name: 'descriptionEn', default: '' })
  descriptionEn!: string;

  /* An optional line directly under the name. */
  @Column({ type: 'varchar', length: 150, name: 'subtitleMr', default: '' })
  subtitleMr!: string;

  @Column({ type: 'varchar', length: 150, name: 'subtitleEn', default: '' })
  subtitleEn!: string;

  @Column({ type: 'varchar', length: 120, name: 'photoKey', nullable: true })
  photoKey!: string | null;

  @Column({ type: 'integer', name: 'displayOrder', default: 0 })
  displayOrder!: number;
}
