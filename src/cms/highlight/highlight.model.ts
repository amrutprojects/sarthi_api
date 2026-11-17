import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/*
 * The rows of the fact table beside the band, in display order, each of which the admin can hide or rename. Fixed:
 * the website owns the default labels and reads the values from the Modules and Programme content, so the CMS
 * stores a key, its switch and an optional custom name. The same list is CHK_programme_highlight_hidden_rows
 * (HighlightHiddenRows migration).
 */
export const HIGHLIGHT_ROW_KEYS = [
  'totalDuration',
  'idealCompletion',
  'candidatureValidity',
  'perModule',
  'schedule',
  'securityDeposit',
  'certification',
] as const;
export type HighlightRowKey = (typeof HIGHLIGHT_ROW_KEYS)[number];

/* A row's custom name, in both languages. */
export interface HighlightRowLabel {
  mr: string;
  en: string;
}

/* The customised row names, by row key. A row that is absent keeps the website's default name. */
export type HighlightRowLabels = Partial<Record<HighlightRowKey, HighlightRowLabel>>;

/*
 * The home page's programme section: the band headed "AMRUT KALASH — Skill Development Diploma",
 * its tagline, its objectives and the certification line.
 *
 * The fact sheet beside it on the page is NOT here. Its totals are summed from the modules, and its
 * entered figures (duration, validity, deposit, partner) live with the Programme page content;
 * storing them again would be a second place for the same numbers to disagree.
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

  /*
   * The fact table rows the website leaves out. Written only by the per-row switch (PATCH /rows/:key), never by
   * the full-section PUT, so saving the edit form cannot bring a hidden row back. Empty: every row is shown.
   */
  @Column({ type: 'text', array: true, name: 'hiddenRows', default: () => "'{}'" })
  hiddenRows!: HighlightRowKey[];

  /*
   * The fact table rows renamed in the CMS, `{ "<rowKey>": { mr, en } }`; only customised rows are present. Written
   * only by the per-row PATCH /rows/:key, never by the full-section PUT. Empty: every row keeps its default name.
   */
  @Column({ type: 'jsonb', name: 'rowLabels', default: () => "'{}'::jsonb" })
  rowLabels!: HighlightRowLabels;

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
