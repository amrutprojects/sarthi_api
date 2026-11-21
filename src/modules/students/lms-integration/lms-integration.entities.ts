import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { MatchDecision } from '../import/import.service';

/*
 * One LMS create-or-match call (contract amrut-student-api.md §3), keyed by the LMS tenant and its Idempotency-Key.
 * A retry with the same key replays the answer; a call for a learner already answered returns the same student.
 * requestHash covers the body with the Aadhaar number replaced by its blind index (no plaintext, not even hashed).
 */
@Entity({ name: 'lms_student_requests' })
@Index('UQ_lms_student_requests_key', ['lmsTenantCode', 'idempotencyKey'], { unique: true })
@Index('IDX_lms_student_requests_learner', ['lmsTenantCode', 'lmsLearnerRef'])
export class LmsStudentRequest {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', length: 64, name: 'lmsTenantCode' }) lmsTenantCode!: string;
  @Column({ type: 'varchar', length: 100, name: 'idempotencyKey' }) idempotencyKey!: string;
  @Column({ type: 'char', length: 64, name: 'requestHash' }) requestHash!: string;
  @Column({ type: 'varchar', length: 100, name: 'lmsLearnerRef' }) lmsLearnerRef!: string;
  @Column({ type: 'varchar', length: 10 }) result!: 'CREATED' | 'MATCHED' | 'REVIEW';
  @Column({ type: 'varchar', length: 4, nullable: true }) tier!: string | null;
  @Column({ type: 'uuid', name: 'studentId', nullable: true }) studentId!: string | null;
  @Column({ type: 'uuid', name: 'reviewId', nullable: true }) reviewId!: string | null;
  @Column({ type: 'uuid', name: 'apiKeyId', nullable: true }) apiKeyId!: string | null;
  @CreateDateColumn({ type: 'timestamptz', name: 'createdAt' }) createdAt!: Date;
}

/*
 * An LMS create that Amrut holds for its own same-person / different-person decision (REVIEW: same Aadhaar with a
 * different name or date of birth, or same name + date of birth + contact). The decision words are the import's
 * (SAME_PERSON | DIFFERENT_PERSON | HOLD). Until decided, the normalised student values wait in `data` (protected
 * Aadhaar fields in their own columns, encrypted, as on import rows). The review id is the student_id the LMS was
 * given: a DIFFERENT_PERSON decision creates the student with that id; SAME_PERSON links to the matched student.
 */
@Entity({ name: 'lms_student_reviews' })
@Index('IDX_lms_student_reviews_status', ['status', 'createdAt'])
export class LmsStudentReview {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', length: 64, name: 'lmsTenantCode' }) lmsTenantCode!: string;
  @Column({ type: 'varchar', length: 100, name: 'lmsLearnerRef' }) lmsLearnerRef!: string;
  @Column({ type: 'varchar', length: 12, default: 'PENDING' }) status!: 'PENDING' | 'DECIDED';
  @Column({ type: 'uuid', name: 'matchStudentId' }) matchStudentId!: string;
  @Column({ type: 'varchar', length: 4, name: 'matchTier' }) matchTier!: string;
  @Column({ type: 'varchar', length: 300, name: 'matchNote' }) matchNote!: string;
  @Column({ type: 'jsonb' }) data!: Record<string, unknown>;
  @Column({ type: 'bytea', name: 'aadhaarEnc', nullable: true, select: false }) aadhaarEnc!: Buffer | null;
  @Column({ type: 'char', length: 64, name: 'aadhaarBidx', nullable: true }) aadhaarBidx!: string | null;
  @Column({ type: 'char', length: 4, name: 'aadhaarLast4', nullable: true }) aadhaarLast4!: string | null;
  @Column({ type: 'varchar', length: 20, nullable: true }) decision!: MatchDecision | null;
  @Column({ type: 'varchar', length: 500, name: 'decisionReason', nullable: true }) decisionReason!: string | null;
  @Column({ type: 'uuid', name: 'decidedById', nullable: true }) decidedById!: string | null;
  @Column({ type: 'timestamptz', name: 'decidedAt', nullable: true }) decidedAt!: Date | null;
  /* The student the review ended on: the matched one (SAME_PERSON) or the one created (DIFFERENT_PERSON). */
  @Column({ type: 'uuid', name: 'studentId', nullable: true }) studentId!: string | null;
  @Column({ type: 'uuid', name: 'apiKeyId', nullable: true }) apiKeyId!: string | null;
  @CreateDateColumn({ type: 'timestamptz', name: 'createdAt' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz', name: 'updatedAt' }) updatedAt!: Date;
}
