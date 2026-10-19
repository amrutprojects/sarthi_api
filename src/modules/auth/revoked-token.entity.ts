import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { User } from '../users';

/*
 * Token revocation list for logout. Each access token carries a unique `jti`; logging out stores it
 * here until the token's own expiry, and authenticate() rejects any listed jti.
 * Rows past `expiresAt` are useless and are purged on every logout (AuthService.logout).
 */
@Entity({ name: 'revoked_tokens' })
@Index('IDX_revoked_tokens_expiresAt', ['expiresAt'])
export class RevokedToken {
  @PrimaryColumn({ type: 'uuid' })
  jti!: string;

  @Column({ type: 'uuid', name: 'userId' })
  userId!: string;

  @Column({ type: 'timestamptz', name: 'expiresAt' })
  expiresAt!: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'createdAt' })
  createdAt!: Date;

  @ManyToOne('User', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;
}
