import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { EvidenceType, GateClearanceMode } from './track-variant.constants';
import type { LmsTrackVariantModule } from './track-variant-module.model';
import type { LmsTrackVariant } from './track-variant.model';

/*
 * Readiness gate of a Module 3 track variant — F-LMS-32 (Table 58), L-36, DB-337 readiness_gate.
 * Six per variant, numbered 1–6; gate order follows track-module order.
 */
@Entity({ name: 'lms_track_variant_readiness_gates' })
export class LmsTrackVariantReadinessGate extends AppBaseEntity {
  /* F-LMS-32-01 */
  @Column({ type: 'uuid', name: 'trackVariantId' })
  trackVariantId!: string;

  /* F-LMS-32-02: 1 to 6; unique per variant; fixed on creation. */
  @Column({ type: 'smallint', name: 'gateNumber' })
  gateNumber!: number;

  /* F-LMS-32-03: 3–120 characters. */
  @Column({ type: 'varchar', length: 120 })
  title!: string;

  /* F-LMS-32-04: track module of the same variant after which the gate is held. */
  @Column({ type: 'uuid', name: 'heldAfterTrackModuleId' })
  heldAfterTrackModuleId!: string;

  /* F-LMS-32-05: 20–4,000 characters. */
  @Column({ type: 'varchar', length: 4000 })
  demonstration!: string;

  /* F-LMS-32-06: at least one evidence type, plus the text. */
  @Column({ type: 'text', array: true, name: 'evidenceTypes' })
  evidenceTypes!: EvidenceType[];

  @Column({ type: 'varchar', length: 2000, name: 'evidenceNotes', nullable: true })
  evidenceNotes!: string | null;

  /* F-LMS-32-07: 10–2,000 characters. */
  @Column({ type: 'varchar', length: 2000, name: 'remediationPath' })
  remediationPath!: string;

  /* F-LMS-32-08: 'assessor decides' (default) or 'minimum band' with a band 1–5 (no default — OQ-013). */
  @Column({ type: 'varchar', length: 20, name: 'clearanceMode', default: 'ASSESSOR_DECIDES' })
  clearanceMode!: GateClearanceMode;

  @Column({ type: 'smallint', name: 'clearanceMinBand', nullable: true })
  clearanceMinBand!: number | null;

  @ManyToOne('LmsTrackVariant', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'trackVariantId' })
  trackVariant!: LmsTrackVariant;

  @ManyToOne('LmsTrackVariantModule', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'heldAfterTrackModuleId' })
  heldAfterTrackModule!: LmsTrackVariantModule;
}
