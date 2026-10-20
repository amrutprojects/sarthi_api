import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../database/base.entity';

/*
 * One stored document file (spec DB-223 candidate_document). While a batch is under review it belongs to an
 * import row (staged under imports/<batch>/<sourceId>/); finalisation links it to the student and moves it to
 * students/<studentCode>/. Replacing a document soft-deletes the earlier record; files are never served directly.
 */
@Entity({ name: 'student_documents' })
@Index('IDX_student_documents_student', ['studentId'])
@Index('IDX_student_documents_row', ['importRowId'])
@Index('UQ_student_documents_row_type', ['importRowId', 'docType'], { unique: true, where: '"isDelete" = false AND "studentId" IS NULL' })
export class StudentDocument extends AppBaseEntity {
  /* Null for documents uploaded with an admin-entered registration (no import batch). */
  @Column({ type: 'uuid', name: 'batchId', nullable: true }) batchId!: string | null;
  @Column({ type: 'uuid', name: 'importRowId', nullable: true }) importRowId!: string | null;
  @Column({ type: 'uuid', name: 'studentId', nullable: true }) studentId!: string | null;
  @Column({ type: 'varchar', length: 30, name: 'docType' }) docType!: string;
  @Column({ type: 'varchar', length: 300, name: 'storageKey' }) storageKey!: string;
  /* Where the file was inside the uploaded ZIP (as written in the Excel, or found by the folder convention). */
  @Column({ type: 'varchar', length: 300, name: 'sourcePath', nullable: true }) sourcePath!: string | null;
  @Column({ type: 'varchar', length: 255, name: 'originalName' }) originalName!: string;
  @Column({ type: 'varchar', length: 50, name: 'mimeType' }) mimeType!: string;
  @Column({ type: 'integer', name: 'sizeBytes' }) sizeBytes!: number;
  @Column({ type: 'char', length: 64 }) sha256!: string;
  @Column({ type: 'uuid', name: 'uploadedById' }) uploadedById!: string;
  /* Set when a reviewer has checked the file against the registration. */
  @Column({ type: 'timestamptz', name: 'verifiedAt', nullable: true }) verifiedAt!: Date | null;
  @Column({ type: 'uuid', name: 'verifiedById', nullable: true }) verifiedById!: string | null;
}
