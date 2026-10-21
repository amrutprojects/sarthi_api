import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/*
 * The home page's programme section: the band headed "AMRUT KALASH — Skill Development Diploma",
 * its tagline, its objectives and the certification line.
 *
 * The fact sheet beside it on the page is NOT here. Several of those figures are summed from the
 * modules, so they live with the Modules content; storing them again would be a second place for
 * the same numbers to disagree.
 */
@Entity({ name: 'programme_highlight' })
export class ProgrammeHighlight extends AppBaseEntity {
  /* The section heading, in full — "AMRUT KALASH — Skill Development Diploma". */
  @Column({ type: 'varchar', length: 200, name: 'headingMr' })
  headingMr!: string;

  @Column({ type: 'varchar', length: 200, name: 'headingEn' })
  headingEn!: string;

  /* The line under it — what the acronym expands to. */
  @Column({ type: 'varchar', length: 300, name: 'subheadingMr' })
  subheadingMr!: string;

  @Column({ type: 'varchar', length: 300, name: 'subheadingEn' })
  subheadingEn!: string;

  @Column({ type: 'varchar', length: 500, name: 'taglineMr' })
  taglineMr!: string;

  @Column({ type: 'varchar', length: 500, name: 'taglineEn' })
  taglineEn!: string;

  /* The last row of the fact sheet; the only row of it that is text rather than a figure. */
  @Column({ type: 'varchar', length: 300, name: 'certificationMr' })
  certificationMr!: string;

  @Column({ type: 'varchar', length: 300, name: 'certificationEn' })
  certificationEn!: string;

  @Column({ type: 'boolean', name: 'isPublished', default: true })
  isPublished!: boolean;

  @OneToMany('ProgrammeHighlightObjective', (o: ProgrammeHighlightObjective) => o.highlight)
  objectives!: ProgrammeHighlightObjective[];
}

/* One ticked line in the objectives list. */
@Entity({ name: 'programme_highlight_objectives' })
@Index('IDX_programme_highlight_objectives_highlightId', ['highlightId'])
export class ProgrammeHighlightObjective extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'highlightId' })
  highlightId!: string;

  @Column({ type: 'varchar', length: 400, name: 'textMr' })
  textMr!: string;

  @Column({ type: 'varchar', length: 400, name: 'textEn' })
  textEn!: string;

  @Column({ type: 'integer', name: 'displayOrder', default: 0 })
  displayOrder!: number;

  @ManyToOne('ProgrammeHighlight', (h: ProgrammeHighlight) => h.objectives, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'highlightId' })
  highlight!: ProgrammeHighlight;
}
