import { Check, Column, Entity, Index, OneToMany } from 'typeorm';
import { AppBaseEntity } from './base.entity';
import type { UserRole } from './user-role.entity';

@Entity({ name: 'users' })
@Check('CHK_users_email_lower', '"email" = lower("email")')
/* Email is unique among non-deleted users only, so a soft-deleted account does not block re-registration. */
@Index('UQ_users_email_active', ['email'], { unique: true, where: '"isDelete" = false' })
export class User extends AppBaseEntity {
  @Column({ type: 'varchar', length: 150 })
  name!: string;

  /* Always stored lower-cased (see UserService). */
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  /* bcrypt hash. Never selected by default and never serialised to API responses. */
  @Column({ type: 'varchar', length: 255, name: 'passwordHash', select: false })
  passwordHash!: string;

  @Column({ type: 'timestamptz', name: 'lastLoginAt', nullable: true })
  lastLoginAt!: Date | null;

  @OneToMany('UserRole', (ur: UserRole) => ur.user)
  userRoles!: UserRole[];
}
