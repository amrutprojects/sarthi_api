/* Entity registry (composition root): imports entity files directly so the DataSource never depends on module indexes. */
import { AuditLog } from '../modules/audit/audit-log.entity';
import { ImportBatch } from '../modules/students/import/import-batch.entity';
import { ImportRow } from '../modules/students/import/import-row.entity';
import { Permission } from '../modules/roles-permissions/permissions/permission.entity';
import { RevokedToken } from '../modules/auth/revoked-token.entity';
import { RoleMenuVisibility } from '../modules/roles-permissions/menu-visibility/role-menu-visibility.entity';
import { RolePermission } from '../modules/roles-permissions/role-permission.entity';
import { Role } from '../modules/roles-permissions/roles/role.entity';
import { Student } from '../modules/students/register/student.entity';
import { UserRole } from '../modules/roles-permissions/user-role.entity';
import { User } from '../modules/users/user.entity';
import { IdempotencyKey } from '../shared/idempotency/idempotency-key.entity';
import { StudentDocument } from '../modules/students/documents/student-document.entity';
import { Caste, DocumentType, Education, Region } from '../modules/masters/master.entity';

export { AppBaseEntity } from './base.entity';
export { Caste, DocumentType, Education, Region };
export { AuditLog, ImportBatch, ImportRow, Permission, RevokedToken, Role, RoleMenuVisibility, RolePermission, Student, User, UserRole };
export type { AuditOutcome } from '../modules/audit';

/* Explicit entity registration for the DataSource (no glob loading). */
export const ENTITIES = [
  User,
  Role,
  Permission,
  UserRole,
  RolePermission,
  AuditLog,
  RevokedToken,
  RoleMenuVisibility,
  ImportBatch,
  ImportRow,
  Student,
  IdempotencyKey,
  StudentDocument,
  Region,
  Caste,
  DocumentType,
  Education,
];
