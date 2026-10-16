import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from './base.entity';
import type { Role } from './role.entity';

/*
 * Per-role sidebar visibility of an admin panel menu. No row means visible. Hiding a menu revokes no
 * permission; it only removes the menu (and its page) from that role's panel.
 */
@Entity({ name: 'role_menu_visibility' })
@Index('UQ_role_menu_visibility_active', ['roleId', 'menuKey'], { unique: true, where: '"isDelete" = false' })
export class RoleMenuVisibility extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'roleId' })
  roleId!: string;

  @Column({ type: 'varchar', length: 64, name: 'menuKey' })
  menuKey!: string;

  @Column({ type: 'boolean', name: 'isVisible', default: true })
  isVisible!: boolean;

  @ManyToOne('Role', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'roleId' })
  role!: Role;
}
