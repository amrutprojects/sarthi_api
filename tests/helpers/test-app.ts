import 'reflect-metadata';
import bcrypt from 'bcrypt';
import request from 'supertest';
import type { Express } from 'express';
import { In } from 'typeorm';
import { createApp } from '../../src/app';
import { AppDataSource } from '../../src/config/database.config';
import { env } from '../../src/config/env.config';
import { ROLE_CODES } from '../../src/modules/roles-permissions/role.constants';
import { Permission, Role, RolePermission, User, UserRole } from '../../src/database/entities';
import { rbacService } from '../../src/modules/roles-permissions/rbac.service';
import { seedRbac } from '../../src/database/seeds/seed-rbac';
import { assertTestDatabase } from './guard';
import { TEST_EDUCATIONS } from './masters';

export const API = '/api/v1';
export const PASSWORD = 'Test-Password-123';

let app: Express;
let counter = 0;

/* Per test file: connect, wipe all rows (test DB only), seed RBAC, build the app. */
export async function setupTestApp(): Promise<Express> {
  assertTestDatabase(env.DB_DATABASE);
  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  await resetData();
  app = createApp();
  return app;
}

export async function teardownTestApp(): Promise<void> {
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
}

/* audit_logs is append-only (UPDATE/DELETE blocked by trigger), but TRUNCATE is allowed for tests. */
export async function resetData(): Promise<void> {
  assertTestDatabase(env.DB_DATABASE);
  await AppDataSource.query(
    'TRUNCATE "revoked_tokens", "audit_logs", "role_menu_visibility", "student_documents", "import_rows", "students", "import_batches", "idempotency_keys", "role_permissions", "user_roles", "permissions", "roles", "users", ' +
      '"talukas", "districts", "states", "contact_organizations", "contact_page_settings", "programme_page_settings", ' +
      '"programme_elective_domains", "programme_modules", "programme_module_settings", "home_hero_slides", "home_hero", "board_members", "board_section", "ecosystem_programmes", "ecosystem_section", "amrut_schemes", "amrut_schemes_section", "about_cards", "about_facts", "about_section", "impact_stats", "impact_section" RESTART IDENTITY CASCADE',
  );
  await seedRbac(AppDataSource);
  rbacService.invalidate();
  /* Masters are not truncated (the migration seeds them); tests add the education values their fixtures use. */
  for (const [i, name] of TEST_EDUCATIONS.entries())
    await AppDataSource.query(`INSERT INTO "educations" ("code", "name") VALUES ($1, $2) ON CONFLICT DO NOTHING`, [`TEST_E${i + 1}`, name]);
}

const hashCache = new Map<string, string>();
async function hash(pw: string) {
  if (!hashCache.has(pw)) hashCache.set(pw, await bcrypt.hash(pw, 4));
  return hashCache.get(pw)!;
}

export interface TestActor {
  user: User;
  token: string;
  role?: Role;
}

/* Creates a user directly in the database (bypassing the API) with the given roles. */
export async function createUser(opts: { roleCodes?: string[]; isActive?: boolean; password?: string; name?: string } = {}): Promise<User> {
  counter++;
  const users = AppDataSource.getRepository(User);
  const user = await users.save(
    users.create({
      name: opts.name ?? `Test User ${counter}`,
      email: `user${counter}.${Date.now()}@test.local`,
      passwordHash: await hash(opts.password ?? PASSWORD),
      isActive: opts.isActive ?? true,
    }),
  );
  if (opts.roleCodes?.length) {
    const roles = await AppDataSource.getRepository(Role).find({ where: { code: In(opts.roleCodes), isDelete: false } });
    await AppDataSource.getRepository(UserRole).insert(roles.map((r) => ({ userId: user.id, roleId: r.id })));
  }
  rbacService.invalidate();
  return user;
}

/* Creates a custom role holding exactly the given permission codes. */
export async function createRoleWith(codes: string[], code = `TEST_ROLE_${++counter}`): Promise<Role> {
  const roles = AppDataSource.getRepository(Role);
  const role = await roles.save(roles.create({ name: code, code }));
  if (codes.length) {
    const perms = await AppDataSource.getRepository(Permission).find({ where: { code: In(codes), isDelete: false } });
    if (perms.length !== codes.length) throw new Error(`unknown permission in ${codes.join(',')}`);
    await AppDataSource.getRepository(RolePermission).insert(perms.map((p) => ({ roleId: role.id, permissionId: p.id })));
  }
  rbacService.invalidate();
  return role;
}

export async function login(email: string, password = PASSWORD): Promise<string> {
  const res = await request(app).post(`${API}/auth/login`).set('X-Auth-Mode', 'bearer').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data.accessToken as string;
}

/* A signed-in user whose only role grants exactly `codes`. */
export async function actorWith(codes: string[]): Promise<TestActor> {
  const role = await createRoleWith(codes);
  const user = await createUser({ roleCodes: [role.code] });
  return { user, role, token: await login(user.email) };
}

export async function superAdmin(): Promise<TestActor> {
  const user = await createUser({ roleCodes: [ROLE_CODES.SUPER_ADMIN] });
  return { user, token: await login(user.email) };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function permissionId(code: string): Promise<string> {
  const p = await AppDataSource.getRepository(Permission).findOneOrFail({ where: { code, isDelete: false } });
  return p.id;
}

export async function roleId(code: string): Promise<string> {
  const r = await AppDataSource.getRepository(Role).findOneOrFail({ where: { code, isDelete: false } });
  return r.id;
}

export { request, AppDataSource };
