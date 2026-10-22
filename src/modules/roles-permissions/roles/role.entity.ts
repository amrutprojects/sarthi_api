import { Column, Entity, Index, OneToMany } from 'typeorm';
import { AppBaseEntity } from '../../../database/base.entity';
import type { RolePermission } from '../role-permission.entity';
import type { UserRole } from '../user-role.entity';
import type { RolePlatform } from '../role.constants';

@Entity({ name: 'roles' })
@Index('UQ_roles_code_active', ['code'], { unique: true, where: '"isDelete" = false' })
export class Role extends AppBaseEntity {
  @Column({ type: 'varchar', length: 100 })
  name!: string;

  /* Stable machine code, e.g. SUPER_ADMIN. Upper snake case. */
  @Column({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /* System roles (seeded) cannot be deleted, deactivated or renamed through the API. */
  @Column({ type: 'boolean', name: 'isSystem', default: false })
  isSystem!: boolean;

  /*
   * Which application the role is for. ADMIN roles carry Admin Panel permissions (role_permissions); LMS roles carry
   * LMS menus (role_lms_permissions, handed to the LMS at sign-in) and never any Admin Panel permission.
   */
  @Column({ type: 'varchar', length: 10, default: 'ADMIN' })
  platform!: RolePlatform;

  @OneToMany('RolePermission', (rp: RolePermission) => rp.role)
  rolePermissions!: RolePermission[];

  @OneToMany('UserRole', (ur: UserRole) => ur.role)
  userRoles!: UserRole[];
}
