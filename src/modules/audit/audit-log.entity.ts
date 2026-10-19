import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { User } from '../users';

export type AuditOutcome = 'SUCCESS' | 'FAILURE' | 'DENIED';

/*
 * Append-only record of security-sensitive events.
 *
 * Deliberately does NOT extend AppBaseEntity: audit entries are immutable, so they have no
 * updatedAt, and they can never be soft-deleted or deactivated. Never stores passwords or tokens.
 */
@Entity({ name: 'audit_logs' })
@Check('CHK_audit_logs_outcome', `"outcome" IN ('SUCCESS', 'FAILURE', 'DENIED')`)
@Index('IDX_audit_logs_actor', ['actorUserId'])
@Index('IDX_audit_logs_resource', ['resource', 'resourceId'])
@Index('IDX_audit_logs_createdAt', ['createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'createdAt' })
  createdAt!: Date;

  @Column({ type: 'uuid', name: 'actorUserId', nullable: true })
  actorUserId!: string | null;

  /* e.g. auth.login, role.permissions.replace, user.roles.replace, authz.denied */
  @Column({ type: 'varchar', length: 100 })
  action!: string;

  /* e.g. user, role, permission, auth */
  @Column({ type: 'varchar', length: 64 })
  resource!: string;

  @Column({ type: 'varchar', length: 100, name: 'resourceId', nullable: true })
  resourceId!: string | null;

  @Column({ type: 'varchar', length: 100, name: 'requestId', nullable: true })
  requestId!: string | null;

  @Column({ type: 'varchar', length: 16 })
  outcome!: AuditOutcome;

  @Column({ type: 'varchar', length: 64, name: 'ipAddress', nullable: true })
  ipAddress!: string | null;

  /* Non-sensitive context only (ids, codes, counts). */
  @Column({ type: 'jsonb', nullable: true })
  details!: Record<string, unknown> | null;

  @ManyToOne('User', { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'actorUserId' })
  actor!: User | null;
}
