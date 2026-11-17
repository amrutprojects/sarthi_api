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

/*
 * Tables whose rows come from a migration (reference lists with no other re-seed), the website content the CMS
 * tests leave in place, and the migrations table itself; everything else is emptied between test files so no file
 * sees another file's records (the LMS and Masters-group tables included, whatever is added later).
 */
const KEEP_ON_RESET = new Set([
  'typeorm_migrations',
  /* Masters group / LMS reference lists seeded by migrations. */
  'training_centre_types', 'technology_tracks',
  /* Generic masters seeded by the Masters migration (src/modules/masters). */
  'regions', 'castes', 'document_types', 'educations',
  /* Website content seeded by the CMS migrations. */
  'programme_module_settings', 'programme_modules', 'programme_elective_domains', 'footer_settings', 'footer_sections', 'footer_links', 'faqs',
  'eligibility_page_settings', 'eligibility_items', 'programme_highlight', 'programme_highlight_objectives',
  'apply_page_settings', 'apply_page_items', 'nav_menu_items',
]);

/* audit_logs is append-only (UPDATE/DELETE blocked by trigger), but TRUNCATE is allowed for tests. */
export async function resetData(): Promise<void> {
  assertTestDatabase(env.DB_DATABASE);
  const tables: { tablename: string }[] = await AppDataSource.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
  const list = tables
    .map((t) => t.tablename)
    .filter((t) => !KEEP_ON_RESET.has(t))
    .map((t) => `"${t}"`)
    .join(', ');
  await AppDataSource.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
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
