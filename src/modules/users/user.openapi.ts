import { z } from 'zod';
import { documentEndpoint, envelope, pagedEnvelope, registry } from '../../shared/openapi/registry';
import { idParams } from '../../shared/validation/common.validation';
import { createUserSchema, listUsersSchema, replaceUserRolesSchema, updateUserSchema, userStatusSchema } from './user.validation';

/* API contract of the users module. Request schemas are the validators themselves; DTOs mirror user.mapper.ts. */
export const RoleRefDto = registry.register('RoleRef', z.object({ id: z.string().uuid(), name: z.string(), code: z.string() }));
export const UserDto = registry.register('User', z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  isActive: z.boolean(),
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  roles: z.array(RoleRefDto).optional().describe('Included when the caller holds roles.view (lists) or always (detail)'),
}).strict());

const tag = 'Users';
documentEndpoint({ method: 'get', path: '/users', tag, summary: 'List users', permission: 'users.view', request: { query: listUsersSchema.query }, response: pagedEnvelope(UserDto) });
documentEndpoint({ method: 'post', path: '/users', tag, summary: 'Create a user', permission: 'users.create', idempotent: true, request: { body: createUserSchema.body }, response: envelope(UserDto), errors: [409] });
documentEndpoint({ method: 'get', path: '/users/:id', tag, summary: 'Get a user', permission: 'users.view', request: { params: idParams }, response: envelope(UserDto), errors: [404] });
documentEndpoint({ method: 'patch', path: '/users/:id', tag, summary: 'Update name, email or password', permission: 'users.update', request: { params: idParams, body: updateUserSchema.body }, response: envelope(UserDto), errors: [404, 409] });
documentEndpoint({ method: 'patch', path: '/users/:id/status', tag, summary: 'Activate or deactivate', permission: 'users.update', request: { params: idParams, body: userStatusSchema.body }, response: envelope(UserDto), errors: [404, 409] });
documentEndpoint({ method: 'delete', path: '/users/:id', tag, summary: 'Soft-delete a user', permission: 'users.delete', request: { params: idParams }, response: envelope(z.null()), errors: [404, 409] });
documentEndpoint({ method: 'post', path: '/users/:id/restore', tag, summary: 'Restore a soft-deleted user (inactive)', permission: 'users.restore', request: { params: idParams }, response: envelope(UserDto), status: 200, errors: [404, 409] });
documentEndpoint({ method: 'get', path: '/users/:id/roles', tag, summary: "List a user's roles", permission: ['users.view', 'roles.view'], request: { params: idParams }, response: envelope(z.array(RoleRefDto)), errors: [404] });
documentEndpoint({ method: 'put', path: '/users/:id/roles', tag, summary: "Replace a user's roles", description: 'Anti-escalation: you cannot change your own roles, and can only grant or remove roles whose permissions you hold.', permission: 'users.assign-roles', request: { params: idParams, body: replaceUserRolesSchema.body }, response: envelope(z.array(RoleRefDto)), errors: [400, 404, 409] });
