# AMRUT × SUMAGO Admin Backend

Node.js + Express + TypeScript + PostgreSQL (TypeORM, `pg`) backend for the React admin panel
(`../admin-panel`). Provides JWT authentication, database-driven RBAC, user / role / permission
management, soft delete everywhere, audit logging and a base for future business modules.

| Concern | Choice |
|---|---|
| Runtime / framework | Node.js ≥ 20, Express 4 |
| Language | TypeScript (strict) |
| Database | PostgreSQL only (TypeORM 0.3 + `pg`) |
| Auth | JWT (HS256) bearer tokens, revocation list for logout |
| Passwords | bcrypt |
| Validation | Zod |
| Logging | Pino (JSON, redacted) + pino-http with request ids |
| Security | Helmet, CORS allow-list, rate limiting (global + login) |
| Tests | Jest + Supertest against an isolated PostgreSQL test database |

---

## 1. Setup

```bash
cd backend
npm install
cp .env.example .env            # development settings
cp .env.example .env.test       # test settings: DB_DATABASE must contain "test"
npm run set-db-password         # writes DB_PASSWORD into .env and .env.test (hidden prompt)
npm run db:create               # creates admin_panel_db and admin_panel_test if missing
npm run migration:run           # creates the schema
npm run seed                    # permissions + 14 roles (idempotent)
npm run admin:create -- --email admin@example.org --name "System Administrator"
npm run dev                     # http://localhost:5000/api/v1
```

`admin:create` reads the password from `ADMIN_INITIAL_PASSWORD` or a hidden prompt (never a CLI
argument, never hard-coded), enforces the password policy and assigns `SUPER_ADMIN`.

## 2. Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Development server (nodemon + ts-node) |
| `npm run build` | Compile to `dist/` |
| `npm start` | Production server from `dist/src/server.js` |
| `npm run typecheck` / `npm run lint` | `tsc --noEmit` / ESLint |
| `npm run db:create` | Create the dev and test databases (never drops anything) |
| `npm run migration:generate -- migrations/<Name>` | Generate a migration from entity changes |
| `npm run migration:create -- migrations/<Name>` | Empty migration |
| `npm run migration:run` / `migration:revert` / `migration:show` | Apply / roll back last / list |
| `npm run migration:run:prod` | Apply migrations from the compiled build |
| `npm run seed` / `seed:prod` | Idempotent RBAC seed |
| `npm run admin:create` / `admin:create:prod` | Create the initial Super Admin |
| `npm test` / `test:coverage` | Jest + Supertest (serial) |

New migrations must also be added to `migrations/index.ts` (explicit registration).

## 3. Environment variables

Validated with Zod at startup; the process exits with a list of problems if any are invalid.
In production the server refuses to start with the placeholder values from `.env.example`.

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | development | development, test, staging, production |
| `PORT` | 5000 | |
| `DB_HOST` `DB_PORT` `DB_USERNAME` `DB_PASSWORD` `DB_DATABASE` | — / 5432 | required; `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DB` are accepted as aliases |
| `DB_SSL` | false | `true` verifies the server certificate |
| `DB_POOL_MAX` | 10 | pg pool size |
| `DB_LOGGING` | false | log SQL |
| `JWT_SECRET` | — | ≥ 32 chars, required |
| `JWT_EXPIRES_IN` | 15m | access-token lifetime |
| `JWT_ISSUER` / `JWT_AUDIENCE` | amrut-admin-backend / amrut-admin-panel | verified on every request |
| `FRONTEND_URL` | http://localhost:5174 | comma-separated CORS allow-list |
| `LOG_LEVEL` | info | |
| `BCRYPT_ROUNDS` | 12 | |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` / `LOGIN_RATE_LIMIT_MAX` | 15 min / 300 / 10 | per IP |
| `PERMISSION_CACHE_TTL_MS` | 60000 | effective-permission cache (cleared on every RBAC change) |

`.env` and `.env.*` (except `.env.example`) are git-ignored.

## 4. Architecture

```
src/
  config/        env (Zod), app, logger (Pino), database (TypeORM DataSource)
  constants/     permission catalogue, initial roles, app constants
  entities/      AppBaseEntity + User, Role, Permission, UserRole, RolePermission, AuditLog, RevokedToken
  repositories/  BaseRepository (soft-delete aware) + one repository per aggregate
  services/      auth, user, role, permission, rbac, audit — all business rules live here
  controllers/   HTTP only: read validated input, call a service, send the envelope
  routes/        versioned routers, each endpoint: authenticate → authorizePermission → validate → controller
  middleware/    request-id, authenticate, authorize-permission, validate-request, error-handler, not-found
  validators/    Zod schemas per resource
  modules/       feature modules (health); add new modules here with the same layering
  utils/         api-response, app-error, async-handler, pagination
migrations/  seeds/  scripts/  tests/
```

### Common fields and soft delete

Every application entity extends `AppBaseEntity` (named to avoid TypeORM's own `BaseEntity`):
`id` UUID, `createdAt` / `updatedAt` TIMESTAMPTZ (UTC connection), `isDelete` (false), `isActive` (true).

- `BaseRepository` adds `isDelete = false` to every find, count, exists and query builder, and to
  `update()` / `updateWhere()` so bulk updates never touch deleted rows. `notDeletedSql()` /
  `usableSql()` apply the same rule in hand-written SQL.
- Ordinary DELETE endpoints call `softDelete()` → `{ isDelete: true, isActive: false }`. The
  application never physically deletes users, roles, permissions or assignments.
- Restore (`POST /:id/restore`, separate permission) brings a record back **inactive**.
- Unique codes / emails / assignments are **partial unique indexes** over non-deleted rows, so
  history is kept without blocking re-creation. Foreign keys are `RESTRICT`.
- A trigger keeps `updatedAt` correct even for raw SQL updates; `audit_logs` is append-only (trigger
  blocks UPDATE/DELETE).
- Exception: `revoked_tokens` is a technical revocation list; expired entries are purged.

## 5. Authentication

- `POST /auth/login` → `{ accessToken, tokenType: "Bearer", expiresIn, expiresAt, user }`.
  One generic error for unknown email, wrong password, inactive or deleted account (bcrypt compare
  runs either way). Login attempts are rate-limited per IP and audited.
- Send `Authorization: Bearer <token>`. Each request verifies signature (HS256 only), expiry, issuer,
  audience and `jti` revocation, **then re-loads the user** — deactivation or deletion takes effect
  immediately, not at token expiry.
- `POST /auth/logout` revokes that token (`jti`) until it expires; other sessions stay valid.
- Tokens carry no permissions; authorization is always resolved from the database.
- Passwords, hashes and tokens are never returned, logged (Pino redaction) or audited.

## 6. RBAC

Effective permissions = permissions with a non-deleted grant to a role the user holds through a
non-deleted assignment — where the user, role and permission are all active and not deleted.
Resolved per request (cached per user, cache cleared on every RBAC change).

`authenticate` → `authorizePermission('users.view')` on every protected route; deny by default;
**401** when unauthenticated, **403** when the permission is missing (denials are audited).

Service-level safeguards (beyond route permissions):
1. Nobody can change their **own** roles.
2. Assigning (or removing) a role requires holding **every permission** that role grants.
3. Granting a permission to a role requires holding that permission.
4. Changing the permissions of a role you hold requires Super Admin.
5. `SUPER_ADMIN` cannot be deleted, deactivated or edited via the API; the **last active Super
   Admin** cannot be demoted, deactivated or deleted. You cannot delete / deactivate yourself.
6. Deleted / inactive roles and permissions cannot be assigned and grant nothing.

The catalogue (55 permissions) is in `src/constants/permission.constants.ts`, mapped to the admin
panel modules; the 14 initial roles in `role.constants.ts` mirror the admin panel's roles.

## 7. API (prefix `/api/v1`)

Response envelope:

```json
{ "success": true, "message": "Users retrieved successfully", "data": [], "meta": { "page": 1, "limit": 10, "total": 0, "totalPages": 1 } }
{ "success": false, "message": "Validation failed", "error": { "code": "VALIDATION_ERROR", "details": [{ "field": "body.email", "message": "..." }], "requestId": "..." } }
```

List endpoints accept `page`, `limit` (≤ 100), `search`, `sortBy` (whitelisted), `sortOrder`, `isActive`.

| Method & path | Permission |
|---|---|
| `GET /health` | public |
| `POST /auth/login` | public (rate-limited) |
| `POST /auth/logout`, `GET /auth/me`, `GET /auth/permissions` | authenticated |
| `GET /users` (`roleId` filter), `GET /users/:id` | `users.view` |
| `POST /users` (optional `roleIds` also needs `users.assign-roles`) | `users.create` |
| `PATCH /users/:id` (name, email, password) | `users.update` |
| `PATCH /users/:id/status` `{ isActive }` | `users.update` |
| `DELETE /users/:id` (soft) | `users.delete` |
| `POST /users/:id/restore` | `users.restore` |
| `GET /users/:id/roles` | `users.view` + `roles.view` |
| `PUT /users/:id/roles` `{ roleIds }` | `users.assign-roles` |
| `GET /roles`, `GET /roles/:id` | `roles.view` |
| `POST /roles` (optional `permissionIds` also needs `permissions.assign`) | `roles.create` |
| `PATCH /roles/:id`, `PATCH /roles/:id/status` | `roles.update` |
| `DELETE /roles/:id` (soft) / `POST /roles/:id/restore` | `roles.delete` / `roles.restore` |
| `GET /roles/:id/permissions` | `roles.view` + `permissions.view` |
| `PUT /roles/:id/permissions` `{ permissionIds }` | `permissions.assign` |
| `GET /permissions` (`module` filter), `GET /permissions/modules`, `GET /permissions/:id` | `permissions.view` |
| `POST /permissions` / `PATCH /permissions/:id` / `PATCH .../status` | `permissions.create` / `.update` |
| `DELETE /permissions/:id` (soft) / `POST .../restore` | `permissions.delete` / `.restore` |
| `GET /audit-logs` (`action`, `resource`, `resourceId`, `actorUserId`) | `audit.view` |

Status codes: 200, 201, 400 (bad input / unusable ids), 401, 403, 404, 409 (duplicates, last Super
Admin), 413, 422 (validation), 429, 500 (generic message; details only in server logs), 503 (health).

## 8. Testing

Tests need PostgreSQL and `.env.test` pointing at a database whose name contains `test`
(the helpers refuse anything else). `globalSetup` rebuilds that database's schema from the
migrations; each file truncates and re-seeds before it runs.

```bash
npm test
```

## 9. Deployment

1. Provision PostgreSQL and a dedicated database/user per environment (dev, test, staging, prod).
2. Set the environment variables (secrets from your secret manager, `DB_SSL=true`, a long random
   `JWT_SECRET`, the production `FRONTEND_URL`).
3. `npm ci && npm run build`
4. `npm run migration:run:prod` (back up first; migrations never drop data, `synchronize` is off)
5. `npm run seed:prod` (idempotent), then `npm run admin:create:prod -- --email ... --name ...` once
6. `npm start` behind HTTPS (reverse proxy). The server refuses to start with pending migrations.
7. Rollback: `npm run migration:revert` reverts the most recent migration (review its `down()` first).

Several instances can run behind a load balancer; permission caches are per instance and bounded
by `PERMISSION_CACHE_TTL_MS`. Rate limits are per instance (use a shared store for strict global limits).
