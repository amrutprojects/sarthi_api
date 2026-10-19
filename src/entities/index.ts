import { AuditLog } from './audit-log.entity';
import { ImportBatch } from './import-batch.entity';
import { ImportRow } from './import-row.entity';
import { Permission } from './permission.entity';
import { RevokedToken } from './revoked-token.entity';
import { RoleMenuVisibility } from './role-menu-visibility.entity';
import { RolePermission } from './role-permission.entity';
import { Role } from './role.entity';
import { Student } from './student.entity';
import { UserRole } from './user-role.entity';
import { User } from './user.entity';

export { AppBaseEntity } from './base.entity';
export { AuditLog, ImportBatch, ImportRow, Permission, RevokedToken, Role, RoleMenuVisibility, RolePermission, Student, User, UserRole };
export type { AuditOutcome } from './audit-log.entity';

/* Explicit entity registration for the DataSource (no glob loading). */
export const ENTITIES = [User, Role, Permission, UserRole, RolePermission, AuditLog, RevokedToken, RoleMenuVisibility, ImportBatch, ImportRow, Student];
