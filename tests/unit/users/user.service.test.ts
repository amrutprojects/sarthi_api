/*
 * Service unit test with mocked dependencies: no database. Shows the pattern for testing business
 * rules in isolation (persistence and other modules are replaced at their public boundaries).
 */
jest.mock('../../../src/modules/users/user.repository', () => ({
  userRepository: { findById: jest.fn(), list: jest.fn() },
}));
jest.mock('../../../src/modules/roles-permissions', () => ({
  rbacService: { invalidate: jest.fn() },
  roleAssignmentService: { rolesOfUser: jest.fn(), rolesOfUsers: jest.fn() },
}));
jest.mock('../../../src/modules/audit', () => ({ auditService: { recordInTx: jest.fn(), record: jest.fn() } }));
jest.mock('../../../src/config/database.config', () => ({ AppDataSource: { transaction: jest.fn() } }));

import { roleAssignmentService } from '../../../src/modules/roles-permissions';
import { userRepository } from '../../../src/modules/users/user.repository';
import { userService } from '../../../src/modules/users/user.service';
import { toPublicUser } from '../../../src/modules/users/user.mapper';
import type { User } from '../../../src/modules/users/user.entity';
import type { AuthUser } from '../../../src/modules/auth';

const user = (over: Partial<User> = {}) =>
  ({
    id: 'u1',
    name: 'Asha',
    email: 'asha@test.local',
    isActive: true,
    isDelete: false,
    lastLoginAt: null,
    passwordHash: '$2b$secret',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    ...over,
  }) as unknown as User;
const actor = { id: 'admin', permissions: new Set<string>(), roleCodes: [] } as unknown as AuthUser;

describe('userService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('get() maps the entity to the public DTO with roles, never exposing the password hash', async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(user());
    jest.mocked(roleAssignmentService.rolesOfUser).mockResolvedValue([{ id: 'r1', name: 'Viewer', code: 'VIEWER' }]);
    const out = await userService.get('u1');
    expect(out).toEqual({ ...toPublicUser(user()), roles: [{ id: 'r1', name: 'Viewer', code: 'VIEWER' }] });
    expect(JSON.stringify(out)).not.toContain('secret');
  });

  it('get() throws 404 for an unknown user', async () => {
    jest.mocked(userRepository.findById).mockResolvedValue(null);
    await expect(userService.get('nope')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('list() fetches roles in one call only when asked to include them', async () => {
    jest
      .mocked(userRepository.list)
      .mockResolvedValue({ items: [user(), user({ id: 'u2' })], meta: { page: 1, limit: 25, total: 2, totalPages: 1 } });
    jest.mocked(roleAssignmentService.rolesOfUsers).mockResolvedValue(
      new Map([
        ['u1', []],
        ['u2', []],
      ]),
    );
    const q = { page: 1, limit: 25, sortBy: 'createdAt' as const, sortOrder: 'DESC' as const };
    await userService.list(q, false);
    expect(roleAssignmentService.rolesOfUsers).not.toHaveBeenCalled();
    const withRoles = await userService.list(q, true);
    expect(roleAssignmentService.rolesOfUsers).toHaveBeenCalledTimes(1);
    expect(withRoles.items[1].roles).toEqual([]);
  });

  it('refuses to deactivate or delete your own account before touching the database', async () => {
    await expect(userService.setStatus('admin', false, actor)).rejects.toMatchObject({ statusCode: 403 });
    await expect(userService.remove('admin', actor)).rejects.toMatchObject({ statusCode: 403 });
    expect(userRepository.findById).not.toHaveBeenCalled();
  });
});
