import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { Role } from './roles/role.entity';
import type { User } from '../users';

/*
 * Assignment of a role to a user. Removing an assignment soft-deletes the row, so history is kept;
 * only one non-deleted row may exist per (user, role).
 */
@Entity({ name: 'user_roles' })
@Index('UQ_user_roles_active', ['userId', 'roleId'], { unique: true, where: '"isDelete" = false' })
@Index('IDX_user_roles_roleId', ['roleId'])
export class UserRole extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'userId' })
  userId!: string;

  @Column({ type: 'uuid', name: 'roleId' })
  roleId!: string;

  @Column({ type: 'uuid', name: 'assignedById', nullable: true })
  assignedById!: string | null;

  @ManyToOne('User', (u: User) => u.userRoles, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @ManyToOne('Role', (r: Role) => r.userRoles, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'roleId' })
  role!: Role;

  @ManyToOne('User', { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'assignedById' })
  assignedBy!: User | null;
}
