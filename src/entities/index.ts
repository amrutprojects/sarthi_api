import { AuditLog } from './audit-log.entity';
import { Permission } from './permission.entity';
import { RevokedToken } from './revoked-token.entity';
import { RoleMenuVisibility } from './role-menu-visibility.entity';
import { RolePermission } from './role-permission.entity';
import { Role } from './role.entity';
import { UserRole } from './user-role.entity';
import { User } from './user.entity';
import { MASTER_ENTITIES, District, State, Taluka } from '../masters/masters.entities';

export { AppBaseEntity } from './base.entity';
export { AuditLog, District, Permission, RevokedToken, Role, RoleMenuVisibility, RolePermission, State, Taluka, User, UserRole };
export type { AuditOutcome } from './audit-log.entity';

/*
 * Explicit entity registration for the DataSource (no glob loading).
 * Models that live with their module (src/masters) are contributed through MASTER_ENTITIES, so this
 * stays the one place the DataSource reads.
 */
export const ENTITIES = [User, Role, Permission, UserRole, RolePermission, AuditLog, RevokedToken, RoleMenuVisibility, ...MASTER_ENTITIES];
