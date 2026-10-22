import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { LearningComponentKind } from './track-variant.constants';
import type { LmsTrackVariantModule } from './track-variant-module.model';
import type { LmsTrackVariant } from './track-variant.model';

/*
 * A learning component of the Module 3 shape: mini and integration projects, the capstone project, the business
 * simulation and the portfolio (L-07; kinds of F-LMS-20-03). The slot in the curriculum only: the assignment
 * itself (rubric, acceptance standard, due dates) is configured in Assessments (L-18 / F-LMS-20).
 * One capstone, one business simulation and one portfolio per variant.
 */
@Entity({ name: 'lms_track_variant_components' })
export class LmsTrackVariantComponent extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'trackVariantId' })
  trackVariantId!: string;

  @Column({ type: 'varchar', length: 30 })
  kind!: LearningComponentKind;

  /* F-LMS-20-01: 3–150 characters. */
  @Column({ type: 'varchar', length: 150 })
  title!: string;

  /* Optional: the track module (same variant) the component belongs to. */
  @Column({ type: 'uuid', name: 'trackModuleId', nullable: true })
  trackModuleId!: string | null;

  @Column({ type: 'varchar', length: 3000, nullable: true })
  description!: string | null;

  @ManyToOne('LmsTrackVariant', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'trackVariantId' })
  trackVariant!: LmsTrackVariant;

  @ManyToOne('LmsTrackVariantModule', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'trackModuleId' })
  trackModule!: LmsTrackVariantModule | null;
}
