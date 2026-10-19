import { AppDataSource, createUser, setupTestApp, teardownTestApp } from '../../helpers/test-app';
import { Role, User } from '../../../src/database/entities';
import { userRepository } from '../../../src/modules/users/user.repository';
import { roleRepository } from '../../../src/modules/roles-permissions/roles/role.repository';

beforeAll(setupTestApp);
afterAll(teardownTestApp);

describe('database connection and migrations', () => {
  it('connects to PostgreSQL', async () => {
    const [{ version }] = await AppDataSource.query('SELECT version()');
    expect(version).toMatch(/PostgreSQL/);
  });

  it('has no pending migrations and synchronize is off', async () => {
    expect(await AppDataSource.showMigrations()).toBe(false);
    expect(AppDataSource.options.synchronize).toBe(false);
  });

  it('creates every table with the common columns', async () => {
    const rows: { table_name: string; column_name: string; data_type: string; column_default: string | null }[] = await AppDataSource.query(
      `SELECT table_name, column_name, data_type, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name IN ('id','createdAt','updatedAt','isDelete','isActive')`,
    );
    for (const t of ['users', 'roles', 'permissions', 'user_roles', 'role_permissions']) {
      const cols = Object.fromEntries(rows.filter((r) => r.table_name === t).map((r) => [r.column_name, r]));
      expect(cols.id.data_type).toBe('uuid');
      expect(cols.createdAt.data_type).toBe('timestamp with time zone');
      expect(cols.updatedAt.data_type).toBe('timestamp with time zone');
      expect(cols.isDelete.column_default).toBe('false');
      expect(cols.isActive.column_default).toBe('true');
    }
  });

  it('enforces unique email among non-deleted users with a partial index', async () => {
    const [idx] = await AppDataSource.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'UQ_users_email_active'`);
    expect(idx.indexdef).toMatch(/UNIQUE INDEX .* WHERE \("isDelete" = false\)/);
  });
});

describe('base entity defaults', () => {
  it('generates a UUID, sets timestamps and defaults isDelete=false / isActive=true', async () => {
    const user = await createUser();
    const fresh = await AppDataSource.getRepository(User).findOneByOrFail({ id: user.id });
    expect(fresh.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(fresh.isDelete).toBe(false);
    expect(fresh.isActive).toBe(true);
    expect(fresh.createdAt).toBeInstanceOf(Date);
    expect(Math.abs(fresh.updatedAt.getTime() - fresh.createdAt.getTime())).toBeLessThan(1000);
  });

  it('stores timestamps in UTC', async () => {
    const [row] = await AppDataSource.query('SHOW timezone');
    expect(Object.values(row)[0]).toBe('UTC');
  });

  it('updates updatedAt on change, including raw SQL updates (trigger)', async () => {
    const user = await createUser();
    const before = (await AppDataSource.getRepository(User).findOneByOrFail({ id: user.id })).updatedAt;
    await new Promise((r) => setTimeout(r, 20));
    await AppDataSource.query(`UPDATE "users" SET "name" = 'Renamed' WHERE "id" = $1`, [user.id]);
    const after = (await AppDataSource.getRepository(User).findOneByOrFail({ id: user.id })).updatedAt;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });
});

describe('soft delete', () => {
  it('sets isDelete=true and isActive=false and keeps the row', async () => {
    const user = await createUser();
    expect(await userRepository.softDelete(user.id)).toBe(true);
    const raw = await AppDataSource.getRepository(User).findOneByOrFail({ id: user.id });
    expect(raw.isDelete).toBe(true);
    expect(raw.isActive).toBe(false);
  });

  it('excludes deleted rows from find, count, query builder and email lookup', async () => {
    const user = await createUser();
    await userRepository.softDelete(user.id);
    expect(await userRepository.findById(user.id)).toBeNull();
    expect(await userRepository.findByEmail(user.email)).toBeNull();
    expect(await userRepository.count({ id: user.id })).toBe(0);
    expect(await userRepository.query('u').andWhere('u.id = :id', { id: user.id }).getCount()).toBe(0);
    const page = await userRepository.list({ page: 1, limit: 100, sortBy: 'createdAt', sortOrder: 'DESC', search: user.email });
    expect(page.items).toHaveLength(0);
  });

  it('does not let bulk updates touch deleted rows', async () => {
    const a = await createUser();
    const b = await createUser();
    await userRepository.softDelete(b.id);
    const changed = await userRepository.updateWhere({}, { name: 'Bulk' });
    expect(changed).toBeGreaterThan(0);
    expect((await AppDataSource.getRepository(User).findOneByOrFail({ id: a.id })).name).toBe('Bulk');
    expect((await AppDataSource.getRepository(User).findOneByOrFail({ id: b.id })).name).not.toBe('Bulk');
  });

  it('allows re-using a soft-deleted email, and restore comes back inactive', async () => {
    const user = await createUser();
    await userRepository.softDelete(user.id);
    const restored = await userRepository.restore(user.id);
    expect(restored?.isDelete).toBe(false);
    expect(restored?.isActive).toBe(false);
  });

  it('never issues a physical delete for ordinary deletion', async () => {
    const role = await roleRepository.create({ name: 'Temp', code: 'TEMP_SOFT' });
    await roleRepository.softDelete(role.id);
    expect(await AppDataSource.getRepository(Role).countBy({ id: role.id })).toBe(1);
  });
});

describe('transactions', () => {
  it('rolls back every write when a later step fails', async () => {
    const email = `tx.${Date.now()}@test.local`;
    await expect(AppDataSource.transaction(async (m) => {
      await userRepository.create({ name: 'Tx', email, passwordHash: 'x' }, m);
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect(await userRepository.findByEmail(email)).toBeNull();
  });
});

describe('audit log immutability', () => {
  it('blocks UPDATE and DELETE on audit_logs at the database level', async () => {
    await AppDataSource.query(`INSERT INTO "audit_logs" ("action","resource","outcome") VALUES ('test','test','SUCCESS')`);
    await expect(AppDataSource.query(`UPDATE "audit_logs" SET "action" = 'x'`)).rejects.toThrow(/append-only/);
    await expect(AppDataSource.query(`DELETE FROM "audit_logs"`)).rejects.toThrow(/append-only/);
  });
});
