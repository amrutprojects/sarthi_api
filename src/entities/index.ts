import { AuditLog } from './audit-log.entity';
import { Permission } from './permission.entity';
import { RevokedToken } from './revoked-token.entity';
import { RoleMenuVisibility } from './role-menu-visibility.entity';
import { RolePermission } from './role-permission.entity';
import { Role } from './role.entity';
import { UserRole } from './user-role.entity';
import { User } from './user.entity';
import { CMS_ENTITIES, ContactOrganization, ContactPageSettings, District, State, Taluka } from '../cms/cms.entities';

export { AppBaseEntity } from './base.entity';
export {
  AuditLog, ContactOrganization, ContactPageSettings, District, Permission, RevokedToken, Role,
  RoleMenuVisibility, RolePermission, State, Taluka, User, UserRole,
};
export type { AuditOutcome } from './audit-log.entity';

/*
 * Explicit entity registration for the DataSource (no glob loading).
 * Models that live with their module (src/cms) are contributed through CMS_ENTITIES, so this stays
 * the one place the DataSource reads.
 */
export const ENTITIES = [User, Role, Permission, UserRole, RolePermission, AuditLog, RevokedToken, RoleMenuVisibility, ...CMS_ENTITIES];
