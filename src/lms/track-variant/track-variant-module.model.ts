import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { LmsTrackVariantPhase } from './track-variant-phase.model';
import type { LmsTrackVariant } from './track-variant.model';
import { numericColumn } from './track-variant.constants';

/*
 * A track module of a Module 3 variant (DB-310 unit / track-module code, sort_order; L-08: "a track module
 * belongs to one of the seven phases of its variant", "each track module carrying its lecture hours and
 * practical hours"). 22 or 23 per variant. Order (sortOrder) is unique per variant: readiness gates follow it.
 * Hours are entered from the syllabus (null until entered); their sum against the module's core hours is a
 * completeness warning, never a block (L-08).
 */
@Entity({ name: 'lms_track_variant_modules' })
export class LmsTrackVariantModule extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'trackVariantId' })
  trackVariantId!: string;

  @Column({ type: 'uuid', name: 'phaseId' })
  phaseId!: string;

  @Column({ type: 'varchar', length: 30 })
  code!: string;

  @Column({ type: 'varchar', length: 160 })
  title!: string;

  @Column({ type: 'smallint', name: 'sortOrder' })
  sortOrder!: number;

  /* numeric, read back as a number (numericColumn). */
  @Column({ type: 'numeric', precision: 6, scale: 2, name: 'lectureHours', nullable: true, transformer: numericColumn })
  lectureHours!: number | null;

  @Column({ type: 'numeric', precision: 6, scale: 2, name: 'practicalHours', nullable: true, transformer: numericColumn })
  practicalHours!: number | null;

  @Column({ type: 'varchar', length: 3000, nullable: true })
  description!: string | null;

  @ManyToOne('LmsTrackVariant', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'trackVariantId' })
  trackVariant!: LmsTrackVariant;

  @ManyToOne('LmsTrackVariantPhase', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'phaseId' })
  phase!: LmsTrackVariantPhase;
}
