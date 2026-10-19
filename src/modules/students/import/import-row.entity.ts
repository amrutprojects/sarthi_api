import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../database/base.entity';

export interface StoredIssue { field: string; code: string; message: string; status: 'OPEN' | 'ACCEPTED'; reason?: string; by?: string; at?: string }

/* One source row of a batch with its validation result and identity-match decision (A-14..A-17). */
@Entity({ name: 'import_rows' })
@Index('IDX_import_rows_batch_status', ['batchId', 'status'])
@Index('IDX_import_rows_bidx', ['aadhaarBidx'])
export class ImportRow extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'batchId' }) batchId!: string;
  @Column({ type: 'integer', name: 'rowNumber' }) rowNumber!: number;
  @Column({ type: 'varchar', length: 30 }) status!: string;
  @Column({ type: 'char', length: 64 }) checksum!: string;
  @Column({ type: 'varchar', length: 64, name: 'sourceRecordId', nullable: true }) sourceRecordId!: string | null;
  /* Normalised values (no Aadhaar). */
  @Column({ type: 'jsonb' }) data!: Record<string, unknown>;
  @Column({ type: 'bytea', name: 'aadhaarEnc', nullable: true }) aadhaarEnc!: Buffer | null;
  @Column({ type: 'char', length: 64, name: 'aadhaarBidx', nullable: true }) aadhaarBidx!: string | null;
  @Column({ type: 'char', length: 4, name: 'aadhaarLast4', nullable: true }) aadhaarLast4!: string | null;
  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` }) issues!: StoredIssue[];
  /* Identity match: an existing student, or an earlier row of the same file. */
  @Column({ type: 'uuid', name: 'matchStudentId', nullable: true }) matchStudentId!: string | null;
  @Column({ type: 'integer', name: 'matchRowNumber', nullable: true }) matchRowNumber!: number | null;
  @Column({ type: 'varchar', length: 10, name: 'matchTier', nullable: true }) matchTier!: string | null;
  @Column({ type: 'varchar', length: 200, name: 'matchNote', nullable: true }) matchNote!: string | null;
  @Column({ type: 'varchar', length: 20, nullable: true }) decision!: string | null;
  @Column({ type: 'text', name: 'decisionReason', nullable: true }) decisionReason!: string | null;
  @Column({ type: 'uuid', name: 'decidedById', nullable: true }) decidedById!: string | null;
  @Column({ type: 'timestamptz', name: 'decidedAt', nullable: true }) decidedAt!: Date | null;
  @Column({ type: 'text', name: 'rejectReason', nullable: true }) rejectReason!: string | null;
  @Column({ type: 'uuid', name: 'studentId', nullable: true }) studentId!: string | null;
}
