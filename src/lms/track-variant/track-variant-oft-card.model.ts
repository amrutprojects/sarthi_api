import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import { numericColumn, type CurriculumStatus, type EvidenceType } from './track-variant.constants';
import type { LmsTrackVariantModule } from './track-variant-module.model';
import type { LmsTrackVariant } from './track-variant.model';

/*
 * OFT assignment card of a Module 3 track variant — F-LMS-29 (Table 55), L-35, DB-335 oft_assignment.
 * 12 or 13 per variant. Release to batch (F-LMS-29-11) needs LMS batches, which do not exist in this system.
 */
@Entity({ name: 'lms_track_variant_oft_cards' })
export class LmsTrackVariantOftCard extends AppBaseEntity {
  /* F-LMS-29-03: the module and track the card belongs to (fixed on creation). */
  @Column({ type: 'uuid', name: 'trackVariantId' })
  trackVariantId!: string;

  /* F-LMS-29-01: OFT-M3-{track}-{nn}; unique per variant; immutable once the card is no longer DRAFT. */
  @Column({ type: 'varchar', length: 20, name: 'oftCode' })
  oftCode!: string;

  /* F-LMS-29-02: 3–150 characters. */
  @Column({ type: 'varchar', length: 150 })
  title!: string;

  /* F-LMS-29-04: optional, ≤ 60 characters, as named in the syllabus. */
  @Column({ type: 'varchar', length: 60, nullable: true })
  stage!: string | null;

  /* F-LMS-29-05: optional track module of the same variant after which the card is released. */
  @Column({ type: 'uuid', name: 'linkedTrackModuleId', nullable: true })
  linkedTrackModuleId!: string | null;

  /* F-LMS-29-06: 20–8,000 characters. */
  @Column({ type: 'text' })
  instructions!: string;

  /* F-LMS-29-07: 0 < minimum ≤ maximum. */
  @Column({ type: 'numeric', precision: 6, scale: 2, name: 'hoursMin', transformer: numericColumn })
  hoursMin!: number;

  @Column({ type: 'numeric', precision: 6, scale: 2, name: 'hoursMax', transformer: numericColumn })
  hoursMax!: number;

  /* F-LMS-29-08: 10–1,000 characters. */
  @Column({ type: 'varchar', length: 1000 })
  deliverable!: string;

  /* F-LMS-29-09: at least one evidence type, plus the text. */
  @Column({ type: 'text', array: true, name: 'evidenceTypes' })
  evidenceTypes!: EvidenceType[];

  @Column({ type: 'varchar', length: 2000, name: 'evidenceNotes', nullable: true })
  evidenceNotes!: string | null;

  /* F-LMS-29-10: off where the syllabus card does not state it. */
  @Column({ type: 'boolean', name: 'hostVerificationRequired', default: false })
  hostVerificationRequired!: boolean;

  /* F-LMS-29-12: DRAFT, PUBLISHED (through a content release — here, publishing the variant), RETIRED. */
  @Column({ type: 'varchar', length: 12, default: 'DRAFT' })
  status!: CurriculumStatus;

  @ManyToOne('LmsTrackVariant', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'trackVariantId' })
  trackVariant!: LmsTrackVariant;

  @ManyToOne('LmsTrackVariantModule', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'linkedTrackModuleId' })
  linkedTrackModule!: LmsTrackVariantModule | null;
}
