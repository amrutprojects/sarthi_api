import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { DocumentCategory, VerificationStatus } from '../shared/master.constants';
import type { District } from '../../cms/masters/district/district.model';
import type { TrainingCentre } from '../training-centre/training-centre.model';

/*
 * CMS master: a document (AMRUT_KALASH_02 Table 56). The file itself is stored privately under
 * DOCUMENT_STORAGE_DIR as `storageKey`; only metadata lives here. Soft-deleting a document keeps the file.
 *
 * Verification: PENDING until a user with cms-documents.approve (not the uploader) verifies or rejects it;
 * replacing the file puts it back to PENDING.
 */
@Entity({ name: 'documents' })
export class MasterDocument extends AppBaseEntity {
  @Column({ type: 'varchar', length: 150 })
  title!: string;

  @Column({ type: 'varchar', length: 30 })
  category!: DocumentCategory;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @Column({ type: 'uuid', name: 'districtId', nullable: true })
  districtId!: string | null;

  @Column({ type: 'uuid', name: 'centreId', nullable: true })
  centreId!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'fileName' })
  fileName!: string;

  @Column({ type: 'varchar', length: 100, name: 'mimeType' })
  mimeType!: string;

  @Column({ type: 'integer', name: 'fileSize' })
  fileSize!: number;

  @Column({ type: 'char', length: 64 })
  sha256!: string;

  @Column({ type: 'varchar', length: 100, name: 'storageKey' })
  storageKey!: string;

  @Column({ type: 'uuid', name: 'uploadedById', nullable: true })
  uploadedById!: string | null;

  @Column({ type: 'varchar', length: 10, name: 'verificationStatus', default: 'PENDING' })
  verificationStatus!: VerificationStatus;

  @Column({ type: 'varchar', length: 300, name: 'verificationReason', nullable: true })
  verificationReason!: string | null;

  @Column({ type: 'uuid', name: 'verifiedById', nullable: true })
  verifiedById!: string | null;

  @Column({ type: 'timestamptz', name: 'verifiedAt', nullable: true })
  verifiedAt!: Date | null;

  @ManyToOne('District', { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'districtId' })
  district!: District | null;

  @ManyToOne('TrainingCentre', { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'centreId' })
  centre!: TrainingCentre | null;
}
