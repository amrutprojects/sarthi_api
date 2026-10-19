import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/*
 * Stored outcome of a state-changing request made with an Idempotency-Key header. statusCode is null
 * while the first request is still running. Rows expire after 24 hours.
 */
@Entity({ name: 'idempotency_keys' })
@Index('UQ_idempotency_keys_user_key', ['userId', 'key'], { unique: true })
export class IdempotencyKey {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', length: 100 }) key!: string;
  @Column({ type: 'uuid', name: 'userId' }) userId!: string;
  @Column({ type: 'varchar', length: 10 }) method!: string;
  @Column({ type: 'varchar', length: 300 }) path!: string;
  @Column({ type: 'char', length: 64, name: 'requestHash' }) requestHash!: string;
  @Column({ type: 'integer', name: 'statusCode', nullable: true }) statusCode!: number | null;
  @Column({ type: 'jsonb', name: 'responseBody', nullable: true }) responseBody!: unknown;
  @CreateDateColumn({ type: 'timestamptz', name: 'createdAt' }) createdAt!: Date;
  @Column({ type: 'timestamptz', name: 'expiresAt' }) expiresAt!: Date;
}
