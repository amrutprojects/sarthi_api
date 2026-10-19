import { z } from 'zod';
import { documentEndpoint, envelope, pagedEnvelope, registry } from '../../shared/openapi/registry';
import { idParams } from '../../shared/validation/common.validation';
import { createPermissionSchema, listPermissionsSchema, permissionStatusSchema, updatePermissionSchema } from './permissions/permission.validation';
import { createRoleSchema, listRolesSchema, replaceRolePermissionsSchema, roleStatusSchema, updateRoleSchema } from './roles/role.validation';

const ts = { createdAt: z.string().datetime(), updatedAt: z.string().datetime() };
export const PermissionDto = registry.register('Permission', z.object({
  id: z.string().uuid(), name: z.string(), code: z.string(), module: z.string(), description: z.string().nullable(), isActive: z.boolean(), ...ts,
}));
const PermissionRef = z.object({ id: z.string().uuid(), code: z.string(), name: z.string(), module: z.string() });
export const RoleDto = registry.register('Role', z.object({
  id: z.string().uuid(), name: z.string(), code: z.string(), description: z.string().nullable(), isSystem: z.boolean(), isActive: z.boolean(), ...ts,
  permissions: z.array(PermissionRef).optional().describe('Included on GET /roles/{id}'),
}));
const MenuVisibilityDto = registry.register('MenuVisibility', z.object({
  menus: z.array(z.string()),
  lockedForSuperAdmin: z.array(z.string()),
  roles: z.array(z.object({ id: z.string().uuid(), code: z.string(), name: z.string(), isActive: z.boolean(), hidden: z.array(z.string()) })),
}));

const roles = 'Roles';
documentEndpoint({ method: 'get', path: '/roles', tag: roles, summary: 'List roles', permission: 'roles.view', request: { query: listRolesSchema.query }, response: pagedEnvelope(RoleDto) });
documentEndpoint({ method: 'post', path: '/roles', tag: roles, summary: 'Create a role', permission: 'roles.create', idempotent: true, request: { body: createRoleSchema.body }, response: envelope(RoleDto), errors: [409] });
documentEndpoint({ method: 'get', path: '/roles/:id', tag: roles, summary: 'Get a role with its permissions', permission: 'roles.view', request: { params: idParams }, response: envelope(RoleDto), errors: [404] });
documentEndpoint({ method: 'patch', path: '/roles/:id', tag: roles, summary: 'Rename or describe a role', permission: 'roles.update', request: { params: idParams, body: updateRoleSchema.body }, response: envelope(RoleDto), errors: [404, 409] });
documentEndpoint({ method: 'patch', path: '/roles/:id/status', tag: roles, summary: 'Activate or deactivate a role', permission: 'roles.update', request: { params: idParams, body: roleStatusSchema.body }, response: envelope(RoleDto), errors: [404, 409] });
documentEndpoint({ method: 'delete', path: '/roles/:id', tag: roles, summary: 'Soft-delete a role', permission: 'roles.delete', request: { params: idParams }, response: envelope(z.null()), errors: [404, 409] });
documentEndpoint({ method: 'post', path: '/roles/:id/restore', tag: roles, summary: 'Restore a soft-deleted role (inactive)', permission: 'roles.restore', status: 200, request: { params: idParams }, response: envelope(RoleDto), errors: [404, 409] });
documentEndpoint({ method: 'get', path: '/roles/:id/permissions', tag: roles, summary: "List a role's permissions", permission: ['roles.view', 'permissions.view'], request: { params: idParams }, response: envelope(z.array(PermissionRef)), errors: [404] });
documentEndpoint({ method: 'put', path: '/roles/:id/permissions', tag: roles, summary: "Replace a role's permissions", description: 'Anti-escalation: only permissions you hold; Super Admin grants are protected.', permission: 'permissions.assign', request: { params: idParams, body: replaceRolePermissionsSchema.body }, response: envelope(z.array(PermissionRef)), errors: [400, 404, 409] });

const perms = 'Permissions';
documentEndpoint({ method: 'get', path: '/permissions', tag: perms, summary: 'List permissions', permission: 'permissions.view', request: { query: listPermissionsSchema.query }, response: pagedEnvelope(PermissionDto) });
documentEndpoint({ method: 'get', path: '/permissions/modules', tag: perms, summary: 'Permission modules', permission: 'permissions.view', response: envelope(z.array(z.string())) });
documentEndpoint({ method: 'post', path: '/permissions', tag: perms, summary: 'Create a permission', permission: 'permissions.create', idempotent: true, request: { body: createPermissionSchema.body }, response: envelope(PermissionDto), errors: [409] });
documentEndpoint({ method: 'get', path: '/permissions/:id', tag: perms, summary: 'Get a permission', permission: 'permissions.view', request: { params: idParams }, response: envelope(PermissionDto), errors: [404] });
documentEndpoint({ method: 'patch', path: '/permissions/:id', tag: perms, summary: 'Update a permission', permission: 'permissions.update', request: { params: idParams, body: updatePermissionSchema.body }, response: envelope(PermissionDto), errors: [404, 409] });
documentEndpoint({ method: 'patch', path: '/permissions/:id/status', tag: perms, summary: 'Activate or deactivate a permission', permission: 'permissions.update', request: { params: idParams, body: permissionStatusSchema.body }, response: envelope(PermissionDto), errors: [404] });
documentEndpoint({ method: 'delete', path: '/permissions/:id', tag: perms, summary: 'Soft-delete a permission', permission: 'permissions.delete', request: { params: idParams }, response: envelope(z.null()), errors: [404] });
documentEndpoint({ method: 'post', path: '/permissions/:id/restore', tag: perms, summary: 'Restore a soft-deleted permission (inactive)', permission: 'permissions.restore', status: 200, request: { params: idParams }, response: envelope(PermissionDto), errors: [404, 409] });

const menus = 'Menu visibility';
documentEndpoint({ method: 'get', path: '/menu-visibility', tag: menus, summary: 'Menus hidden per role', permission: 'roles.view', response: envelope(MenuVisibilityDto) });
documentEndpoint({
  method: 'put', path: '/menu-visibility', tag: menus, summary: 'Show or hide menus per role', permission: 'roles.update',
  request: { body: z.object({ changes: z.array(z.object({ roleId: z.string().uuid(), menuKey: z.string(), visible: z.boolean() })).min(1) }) },
  response: envelope(MenuVisibilityDto), errors: [400, 404],
});
