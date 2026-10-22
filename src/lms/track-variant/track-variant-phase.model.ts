import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { LmsTrackVariant } from './track-variant.model';

/*
 * A phase of a Module 3 variant (DB-310 module_phase, phase_no; L-08: "A phase is an ordered grouping level
 * that exists only inside a Module 3 variant"). Seven per variant, numbered 1–7, one per number.
 * The phase names come from each track's syllabus: none is seeded or assumed here. The specification has no
 * phase form; title and description take the bounds of the programme module (F-LMS-07-02 / -06).
 */
@Entity({ name: 'lms_track_variant_phases' })
export class LmsTrackVariantPhase extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'trackVariantId' })
  trackVariantId!: string;

  @Column({ type: 'smallint', name: 'phaseNumber' })
  phaseNumber!: number;

  @Column({ type: 'varchar', length: 160 })
  title!: string;

  @Column({ type: 'varchar', length: 3000, nullable: true })
  description!: string | null;

  @ManyToOne('LmsTrackVariant', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'trackVariantId' })
  trackVariant!: LmsTrackVariant;
}
