import { AuditLog } from './audit-log.entity';
import { Permission } from './permission.entity';
import { RevokedToken } from './revoked-token.entity';
import { RoleMenuVisibility } from './role-menu-visibility.entity';
import { RolePermission } from './role-permission.entity';
import { Role } from './role.entity';
import { UserRole } from './user-role.entity';
import { User } from './user.entity';

export { AppBaseEntity } from './base.entity';
export { AuditLog, Permission, RevokedToken, Role, RoleMenuVisibility, RolePermission, User, UserRole };
export type { AuditOutcome } from './audit-log.entity';

/* Explicit entity registration for the DataSource (no glob loading). */
export const ENTITIES = [User, Role, Permission, UserRole, RolePermission, AuditLog, RevokedToken, RoleMenuVisibility];
