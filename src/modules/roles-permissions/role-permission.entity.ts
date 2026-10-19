import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { Permission } from './permissions/permission.entity';
import type { Role } from './roles/role.entity';
import type { User } from '../users';

/* Grant of a permission to a role. Revoking soft-deletes the row; one non-deleted row per (role, permission). */
@Entity({ name: 'role_permissions' })
@Index('UQ_role_permissions_active', ['roleId', 'permissionId'], { unique: true, where: '"isDelete" = false' })
@Index('IDX_role_permissions_permissionId', ['permissionId'])
export class RolePermission extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'roleId' })
  roleId!: string;

  @Column({ type: 'uuid', name: 'permissionId' })
  permissionId!: string;

  @Column({ type: 'uuid', name: 'assignedById', nullable: true })
  assignedById!: string | null;

  @ManyToOne('Role', (r: Role) => r.rolePermissions, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'roleId' })
  role!: Role;

  @ManyToOne('Permission', (p: Permission) => p.rolePermissions, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'permissionId' })
  permission!: Permission;

  @ManyToOne('User', { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'assignedById' })
  assignedBy!: User | null;
}
