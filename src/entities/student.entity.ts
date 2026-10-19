import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from './base.entity';

/*
 * Approved-student master register (A-18). Rows are created only by import finalisation.
 * Aadhaar is stored encrypted with a blind index and last four digits; it is never returned unmasked.
 */
@Entity({ name: 'students' })
@Index('UQ_students_code', ['code'], { unique: true })
@Index('UQ_students_source_record', ['sourceRecordId'], { unique: true, where: '"isDelete" = false AND "sourceRecordId" IS NOT NULL' })
@Index('IDX_students_bidx', ['aadhaarBidx'])
export class Student extends AppBaseEntity {
  @Column({ type: 'varchar', length: 20 }) code!: string;
  @Column({ type: 'varchar', length: 64, name: 'sourceRecordId', nullable: true }) sourceRecordId!: string | null;
  @Column({ type: 'char', length: 64, name: 'sourceChecksum' }) sourceChecksum!: string;
  @Column({ type: 'varchar', length: 100, name: 'firstName' }) firstName!: string;
  @Column({ type: 'varchar', length: 100, name: 'lastName' }) lastName!: string;
  @Column({ type: 'varchar', length: 150, name: 'fatherName' }) fatherName!: string;
  @Column({ type: 'varchar', length: 150, name: 'motherName' }) motherName!: string;
  @Column({ type: 'varchar', length: 254, nullable: true }) email!: string | null;
  @Column({ type: 'date', name: 'dateOfBirth', nullable: true }) dateOfBirth!: string | null;
  @Column({ type: 'varchar', length: 500, name: 'currentAddress' }) currentAddress!: string;
  @Column({ type: 'bytea', name: 'aadhaarEnc', nullable: true }) aadhaarEnc!: Buffer | null;
  @Column({ type: 'char', length: 64, name: 'aadhaarBidx', nullable: true }) aadhaarBidx!: string | null;
  @Column({ type: 'char', length: 4, name: 'aadhaarLast4', nullable: true }) aadhaarLast4!: string | null;
  @Column({ type: 'varchar', length: 16, nullable: true }) mobile!: string | null;
  @Column({ type: 'varchar', length: 60 }) religion!: string;
  @Column({ type: 'varchar', length: 80 }) caste!: string;
  @Column({ type: 'varchar', length: 10, name: 'centreCode', nullable: true }) centreCode!: string | null;
  /* Null = track to be confirmed (source option not an approved track). */
  @Column({ type: 'varchar', length: 4, name: 'trackCode', nullable: true }) trackCode!: string | null;
  @Column({ type: 'varchar', length: 120, name: 'trackSourceValue' }) trackSourceValue!: string;
  @Column({ type: 'varchar', length: 150, name: 'educationQualification' }) educationQualification!: string;
  @Column({ type: 'varchar', length: 30, name: 'externalStatus' }) externalStatus!: string;
  @Column({ type: 'timestamptz', name: 'approvedAt' }) approvedAt!: Date;
  @Column({ type: 'varchar', length: 120, name: 'evidenceRef', nullable: true }) evidenceRef!: string | null;
  @Column({ type: 'boolean', name: 'declarationAccepted', nullable: true }) declarationAccepted!: boolean | null;
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` }) documents!: Record<string, { supplied: boolean; barcode: string | null }>;
  @Column({ type: 'varchar', length: 30, default: 'RECEIVED' }) status!: string;
  @Column({ type: 'uuid', name: 'importBatchId' }) importBatchId!: string;
}
