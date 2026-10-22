import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { Role } from '../roles-permissions';
import type { User } from '../users';

/*
 * An LMS permission code ticked on an Admin Panel role ("LMS menus"). It grants nothing in the Admin Panel: the codes
 * are handed to the LMS when a holder of the role signs in there. Codes come from the LMS catalogue snapshot
 * (lms-catalogue.data.ts). Removing a tick soft-deletes the row; one non-deleted row per (role, code).
 */
@Entity({ name: 'role_lms_permissions' })
@Index('UQ_role_lms_permissions_active', ['roleId', 'code'], { unique: true, where: '"isDelete" = false' })
export class RoleLmsPermission extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'roleId' })
  roleId!: string;

  @Column({ type: 'varchar', length: 100 })
  code!: string;

  @Column({ type: 'uuid', name: 'assignedById', nullable: true })
  assignedById!: string | null;

  @ManyToOne('Role', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'roleId' })
  role!: Role;

  @ManyToOne('User', { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'assignedById' })
  assignedBy!: User | null;
}
