import { Column, Entity, Index, OneToMany } from 'typeorm';
import { AppBaseEntity } from '../../../database/base.entity';
import type { RolePermission } from '../role-permission.entity';

@Entity({ name: 'permissions' })
@Index('UQ_permissions_code_active', ['code'], { unique: true, where: '"isDelete" = false' })
@Index('IDX_permissions_module', ['module'])
export class Permission extends AppBaseEntity {
  @Column({ type: 'varchar', length: 150 })
  name!: string;

  /* Dotted code checked by authorizePermission(), e.g. users.view. */
  @Column({ type: 'varchar', length: 100 })
  code!: string;

  /* Owning module, e.g. users, candidates, finance. */
  @Column({ type: 'varchar', length: 64 })
  module!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @OneToMany('RolePermission', (rp: RolePermission) => rp.permission)
  rolePermissions!: RolePermission[];
}
