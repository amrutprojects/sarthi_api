import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { LmsTrackVariant } from './track-variant.model';
import { numericColumn } from './track-variant.constants';

/*
 * One of the ten components of the Module 3 track assessment framework — F-LMS-18-10 components[]
 * {code, label, weight, source, indicative}, BRL-343 / BRL-344, DB-340 assessment.components.
 *
 * The weight is To Be Confirmed (OQ-013): indicative syllabus weights are editable defaults and no weight is
 * assumed, so it stays null until entered. Weights, once entered, must total 100 (completeness check).
 */
@Entity({ name: 'lms_track_variant_assessment_components' })
export class LmsTrackVariantAssessmentComponent extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'trackVariantId' })
  trackVariantId!: string;

  @Column({ type: 'varchar', length: 30, name: 'componentCode' })
  componentCode!: string;

  @Column({ type: 'varchar', length: 150 })
  label!: string;

  /* numeric, read back as a number (numericColumn). */
  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: numericColumn })
  weight!: number | null;

  /* Where the weight comes from: the syllabus (indicative) or the reference of the prescribing decision. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  source!: string | null;

  /* Saved weights stay 'indicative' until confirmed (F-LMS-18-10). */
  @Column({ type: 'boolean', default: true })
  indicative!: boolean;

  @Column({ type: 'smallint', name: 'sortOrder' })
  sortOrder!: number;

  @ManyToOne('LmsTrackVariant', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'trackVariantId' })
  trackVariant!: LmsTrackVariant;
}
