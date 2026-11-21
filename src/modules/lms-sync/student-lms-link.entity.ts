import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { SyncStatus } from './lms-sync.constants';

/* One field-level error as the LMS reports it: names and codes only, never values. */
export interface SyncErrorDetail {
  field?: string;
  code: string;
}

/*
 * The link between an Amrut student and its LMS record for one LMS tenant (migration 1798510000000), with the sync
 * flag shown on the student register. Written only by the lms-sync worker and the admin "Push" / "Retry" actions.
 */
@Entity({ name: 'student_lms_link' })
@Index('UQ_student_lms_link_student_tenant', ['studentId', 'lmsTenantCode'], { unique: true })
export class StudentLmsLink extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'studentId' }) studentId!: string;
  @Column({ type: 'varchar', length: 40, name: 'lmsTenantCode' }) lmsTenantCode!: string;
  @Column({ type: 'varchar', length: 12, name: 'syncStatus', default: 'NOT_SYNCED' }) syncStatus!: SyncStatus;
  /* The LMS tenant API does not expose a learner id today (only learner_code); kept for when it does. */
  @Column({ type: 'varchar', length: 64, name: 'lmsLearnerId', nullable: true }) lmsLearnerId!: string | null;
  @Column({ type: 'varchar', length: 64, name: 'lmsLearnerCode', nullable: true }) lmsLearnerCode!: string | null;
  /* intake_request_id of the last POST /tenant/v1/students that carried this student. */
  @Column({ type: 'varchar', length: 64, name: 'lmsRequestId', nullable: true }) lmsRequestId!: string | null;
  /* The LMS intake status last seen (RECEIVED … PROVISIONED). */
  @Column({ type: 'varchar', length: 30, name: 'lmsStatus', nullable: true }) lmsStatus!: string | null;
  @Column({ type: 'jsonb', name: 'lmsReasonCodes', default: () => `'[]'::jsonb` }) lmsReasonCodes!: string[];
  /* SHA-256 of the payload last sent (without source_updated_at); an unchanged checksum is never sent again. */
  @Column({ type: 'char', length: 64, name: 'payloadChecksum', nullable: true }) payloadChecksum!: string | null;
  /* students.updatedAt when the student was last evaluated; a newer one means the student was edited. */
  @Column({ type: 'timestamptz', name: 'studentUpdatedAt', nullable: true }) studentUpdatedAt!: Date | null;
  @Column({ type: 'timestamptz', name: 'sourceUpdatedAtSent', nullable: true }) sourceUpdatedAtSent!: Date | null;
  @Column({ type: 'integer', default: 0 }) attempts!: number;
  @Column({ type: 'varchar', length: 60, name: 'lastErrorCode', nullable: true }) lastErrorCode!: string | null;
  @Column({ type: 'jsonb', name: 'lastErrorDetails', default: () => `'[]'::jsonb` }) lastErrorDetails!: SyncErrorDetail[];
  /* PENDING rows are not sent before this instant (backoff after the LMS was unreachable). */
  @Column({ type: 'timestamptz', name: 'nextAttemptAt', nullable: true }) nextAttemptAt!: Date | null;
  @Column({ type: 'timestamptz', name: 'queuedAt', nullable: true }) queuedAt!: Date | null;
  @Column({ type: 'timestamptz', name: 'lastSentAt', nullable: true }) lastSentAt!: Date | null;
  @Column({ type: 'timestamptz', name: 'lastSyncedAt', nullable: true }) lastSyncedAt!: Date | null;
  @Column({ type: 'timestamptz', name: 'lastCheckedAt', nullable: true }) lastCheckedAt!: Date | null;
}
