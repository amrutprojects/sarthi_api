import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/*
 * An API key Amrut issues to another system (M1: the LMS, which sends it as X-Api-Key). The secret is never stored:
 * only its SHA-256 hash and a short public prefix (shown in the Panel and used to find the row). A rotated key keeps
 * working until expiresAt (the overlap window); a revoked key is refused at once. Rows are never deleted.
 */
@Entity({ name: 'api_keys' })
@Index('UQ_api_keys_prefix', ['prefix'], { unique: true })
export class ApiKey {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', length: 100 }) label!: string;
  @Column({ type: 'varchar', length: 16 }) prefix!: string;
  @Column({ type: 'char', length: 64, name: 'secretHash', select: false }) secretHash!: string;
  @Column({ type: 'text', array: true }) scopes!: string[];
  @Column({ type: 'varchar', length: 12, default: 'ACTIVE' }) status!: 'ACTIVE' | 'REVOKED';
  @Column({ type: 'timestamptz', name: 'expiresAt', nullable: true }) expiresAt!: Date | null;
  @Column({ type: 'uuid', name: 'createdById', nullable: true }) createdById!: string | null;
  @Column({ type: 'timestamptz', name: 'rotatedAt', nullable: true }) rotatedAt!: Date | null;
  @Column({ type: 'uuid', name: 'rotatedById', nullable: true }) rotatedById!: string | null;
  /* The key that replaced this one on rotation, and the key this one replaced. */
  @Column({ type: 'uuid', name: 'replacedById', nullable: true }) replacedById!: string | null;
  @Column({ type: 'uuid', name: 'rotatedFromId', nullable: true }) rotatedFromId!: string | null;
  @Column({ type: 'timestamptz', name: 'revokedAt', nullable: true }) revokedAt!: Date | null;
  @Column({ type: 'uuid', name: 'revokedById', nullable: true }) revokedById!: string | null;
  @Column({ type: 'varchar', length: 300, name: 'revokedReason', nullable: true }) revokedReason!: string | null;
  @Column({ type: 'timestamptz', name: 'lastUsedAt', nullable: true }) lastUsedAt!: Date | null;
  @CreateDateColumn({ type: 'timestamptz', name: 'createdAt' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz', name: 'updatedAt' }) updatedAt!: Date;
}
