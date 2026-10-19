import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../database/base.entity';

export interface ImportBatchCounts {
  total: number; valid: number; exceptions: number; duplicates: number; skipped: number; rejected: number; reconciled: number;
  created?: number; linked?: number;
}

/* One received file (A-11/A-12). The raw file is not kept; its SHA-256 prevents a second batch from the same file. */
@Entity({ name: 'import_batches' })
@Index('UQ_import_batches_code', ['code'], { unique: true })
@Index('UQ_import_batches_checksum_open', ['fileChecksum'], { unique: true, where: `"isDelete" = false AND "status" <> 'CANCELLED'` })
export class ImportBatch extends AppBaseEntity {
  @Column({ type: 'varchar', length: 20 }) code!: string;
  @Column({ type: 'varchar', length: 30 }) status!: string;
  @Column({ type: 'varchar', length: 20, name: 'sourceChannel', default: 'FILE_UPLOAD' }) sourceChannel!: string;
  @Column({ type: 'varchar', length: 255, name: 'fileName' }) fileName!: string;
  @Column({ type: 'char', length: 64, name: 'fileChecksum' }) fileChecksum!: string;
  @Column({ type: 'integer', name: 'fileSize' }) fileSize!: number;
  @Column({ type: 'varchar', length: 120, name: 'sourceReference', nullable: true }) sourceReference!: string | null;
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` }) counts!: ImportBatchCounts;
  @Column({ type: 'jsonb', name: 'columnMapping', default: () => `'{}'::jsonb` }) columnMapping!: Record<string, string>;
  @Column({ type: 'jsonb', name: 'ignoredColumns', default: () => `'[]'::jsonb` }) ignoredColumns!: string[];
  @Column({ type: 'text', name: 'failureReason', nullable: true }) failureReason!: string | null;
  @Column({ type: 'uuid', name: 'createdById' }) createdById!: string;
  @Column({ type: 'uuid', name: 'finalisedById', nullable: true }) finalisedById!: string | null;
  @Column({ type: 'timestamptz', name: 'finalisedAt', nullable: true }) finalisedAt!: Date | null;
  @Column({ type: 'uuid', name: 'cancelledById', nullable: true }) cancelledById!: string | null;
}
