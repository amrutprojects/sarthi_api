# AMRUT × SUMAGO Admin API

REST API for the AMRUT × SUMAGO admin panel ([amrut-kalash-admin](https://github.com/amrutprojects/amrut-kalash-admin)).
Node.js, Express and TypeScript on PostgreSQL, organised as feature modules.

| Concern | Choice |
|---|---|
| Runtime | Node.js ≥ 20, Express 4, TypeScript (strict) |
| Database | PostgreSQL, TypeORM 0.3 (explicit migrations, `synchronize` off) |
| Auth | HttpOnly session cookie + CSRF header for browsers; bearer token for API clients ([ADR-0003](docs/architecture/adr/0003-browser-sessions.md)) |
| Authorization | Database-driven RBAC, checked on every protected endpoint |
| Validation | Zod (the same schemas generate the OpenAPI document) |
| API docs | OpenAPI 3 at `/api/v1/openapi.json`, Swagger UI at `/api/docs` |
| Logging | Pino (JSON, redacted), request ids |
| Security | Helmet, CORS allow-list, rate limits, idempotency keys, audit log |
| Tests | Jest + Supertest: unit (no DB), integration, contract, e2e |

## Quick start

Requires Node.js 20+ and PostgreSQL 14+.

```bash
npm install
cp .env.example .env              # development settings
cp .env.example .env.test         # test settings: DB_DATABASE must contain "test"
npm run set-db-password           # writes DB_PASSWORD into .env and .env.test (hidden prompt)
npm run db:create                 # creates the dev and test databases if missing
npm run migration:run             # creates / upgrades the schema
npm run seed                      # permissions and roles (idempotent)
npm run admin:create -- --email admin@example.org --name "System Administrator"
npm run dev                       # http://localhost:5001/api/v1  ·  docs: http://localhost:5001/api/docs
```

`STUDENT_DATA_KEY` and `STUDENT_INDEX_KEY` must be set (two different 32-byte base64 keys) before the server starts; see `.env.example`.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server with reload |
| `npm run build` / `npm start` | Compile to `dist/` / run the compiled server |
| `npm run typecheck` | TypeScript, no output |
| `npm run lint` | ESLint + module boundary check |
| `npm run format` / `format:check` | Prettier |
| `npm test` | All tests (unit + database) |
| `npm run test:unit` | Unit tests only, no database (seconds) |
| `npm run test:db` / `test:contract` / `test:e2e` | Integration + contract + e2e / contract only / e2e only |
| `npm run test:coverage` | Coverage report in `coverage/` |
| `npm run migration:create -- src/database/migrations/<Name>` | New empty migration (then register it in `src/database/migrations/index.ts`) |
| `npm run migration:generate -- src/database/migrations/<Name>` | Migration generated from entity changes (review before committing) |
| `npm run migration:run` / `migration:revert` / `migration:show` | Apply / roll back the last / list |
| `npm run seed` | Idempotent RBAC seed |
| `npm run admin:create` | First Super Admin (password from `ADMIN_INITIAL_PASSWORD` or a hidden prompt) |
| `npm run demo:users` | Development only: one demo account per role (credentials written to the git-ignored `.demo-credentials`) |
| `npm run *:prod` | `migration:run:prod`, `seed:prod`, `admin:create:prod` run from the compiled build |

## Structure

```
src/
  app.ts                 Express app (middleware, docs, routes); no listening, so tests can drive it
  server.ts              Startup: DB connection, pending-migration check, graceful shutdown
  routes.ts              Composition root: mounts every module router under /api/v1
  openapi.ts             Composition root for the API contract
  config/                Environment (Zod-validated), app settings, TypeORM DataSource
  database/              Base entity / repository, entity registry, migrations/, seeds/
  middleware/            request-id, authenticate (+CSRF), authorize-permission, validate-request, errors
  modules/
    auth/                Login, logout, session cookie, CSRF, token verification
    users/               Users (the reference module — see docs/development-guidelines/module-guide.md)
    roles-permissions/   Roles, permissions, role assignments, RBAC service, menu visibility
    audit/               Append-only audit log
    students/            Approved-student import (import/) and register (register/)
    health/              Liveness and readiness
  shared/                errors, http (envelope), validation, utils, idempotency, openapi registry, types
  observability/         Logger
scripts/                 DB creation, admin creation, demo users, module boundary check
tests/
  unit/                  No database: pure logic, services with mocked dependencies
  integration/           API + database, per module
  contract/              OpenAPI completeness and response-schema checks
  e2e/                   Full workflows (e.g. student import from upload to register)
docs/                    Architecture, ADRs, API, database, development guidelines
```

Each module exposes a public `index.ts`; other modules import only from it (enforced by `npm run lint`).

## Documentation

- [Architecture overview](docs/architecture/README.md) and [decision records](docs/architecture/adr/)
- [Module creation guide and checklist](docs/development-guidelines/module-guide.md)
- [Coding conventions](docs/development-guidelines/conventions.md) · [Testing](docs/development-guidelines/testing.md)
- [API standards](docs/api/README.md) (the full contract is generated: `/api/v1/openapi.json`)
- [Database conventions and migrations](docs/database/README.md)
- [Deployment](docs/architecture/deployment.md)

## Environment variables

Validated at startup (`src/config/env.config.ts`); the process exits listing every problem. `.env` and `.env.*` (except `.env.example`) are git-ignored; staging and production read variables from the secret manager.

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | development | development, test, staging, production |
| `PORT` | 5000 | |
| `DB_HOST` `DB_PORT` `DB_USERNAME` `DB_PASSWORD` `DB_DATABASE` | — / 5432 | required (`PG_*` aliases accepted); one database and user per environment |
| `DB_SSL` / `DB_POOL_MAX` / `DB_LOGGING` | false / 10 / false | |
| `JWT_SECRET` | — | ≥ 32 random characters; also keys the CSRF tokens |
| `JWT_EXPIRES_IN` / `JWT_ISSUER` / `JWT_AUDIENCE` | 15m / amrut-admin-backend / amrut-admin-panel | access-token lifetime and claims |
| `SESSION_COOKIE_NAME` / `COOKIE_SAMESITE` / `COOKIE_SECURE` / `COOKIE_DOMAIN` | amrut_session / strict / auto / unset | browser session cookie |
| `SESSION_MAX_HOURS` | 12 | absolute session length (tokens renew while active) |
| `FRONTEND_URL` | http://localhost:5174 | comma-separated CORS allow-list |
| `API_DOCS_ENABLED` | on except production | Swagger UI and OpenAPI JSON |
| `LOG_LEVEL` / `BCRYPT_ROUNDS` | info / 12 | |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` / `LOGIN_RATE_LIMIT_MAX` | 15 min / 300 / 10 | per IP |
| `PERMISSION_CACHE_TTL_MS` | 60000 | effective-permission cache |
| `STUDENT_DATA_KEY` / `STUDENT_INDEX_KEY` | — | 32-byte base64 keys: Aadhaar encryption / blind index |
| `IMPORT_MAX_FILE_MB` / `IMPORT_MAX_ROWS` | 20 / 50000 | student import limits |
