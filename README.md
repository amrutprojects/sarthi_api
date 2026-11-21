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
| `STORAGE_DIR` | storage | private folder for student documents (relative to the backend folder); back it up |
| `DOCUMENT_MAX_FILE_MB` / `DOCUMENTS_ZIP_MAX_MB` / `DOCUMENTS_ZIP_MAX_FILES` | 5 / 500 / 20000 | documents ZIP limits |
| `LMS_SYNC_ENABLED` / `LMS_EXTERNAL_BASE_URL` / `LMS_TENANT_API_KEY` / `LMS_TENANT_CODE` | false / — / — / — | Amrut → LMS student sync ([docs/lms-sync/README.md](docs/lms-sync/README.md)). No value is preset: all are entered by hand when the Amrut tenant and its LMS link are set up; all three required once the sync is on |

## Student documents (ZIP upload)

Upload a ZIP with the data file (`POST /api/v1/imports`, field `documents`) or later while the batch is under review (`POST /api/v1/imports/:id/documents`). Download the **Excel template** (`GET /api/v1/imports/template.xlsx`, with an instructions sheet) and the matching **sample ZIP** (`GET /api/v1/imports/sample-documents.zip`).

**ZIP layout — one folder per student only:** `<source_record_id>/<file>`, e.g. `MA-0001/photo.jpg` (one wrapping folder around everything is allowed). Files in any other folder, at the top level or with flat names are rejected.

**Which file is which document:**

1. **Excel** — each document column (`doc_photo`, `doc_aadhaar_card`, …) holds the file name inside that student's folder (`photo.jpg`) or `MA-0001/photo.jpg`. A path into any other folder is an issue on that row.
2. **File name** — when a column only says `Yes`: name the file by type inside the student folder, e.g. `MA-0001/AADHAAR_CARD.pdf` (TYPE = PHOTO, SIGNATURE, AADHAAR_CARD, CASTE_CERT, INCOME_EWS, DOMICILE, PAN_CARD, SCHOOL_LEAVING, NAME_CHANGE, EDU_CERT, FITNESS, SELF_DECLARATION or OTHER).

**What happens:**

- Files must be PDF, JPG or PNG **by content**, at most `DOCUMENT_MAX_FILE_MB` each. Path traversal, too many files and oversized archives are refused.
- A row that names a path waits (DOC_MISSING "waiting for …") until that file is stored; a path missing from the ZIP is listed in the batch's documents report. A rejected file adds DOC_INVALID.
- Under review, files are stored as `STORAGE_DIR/imports/<batch>/<source_record_id>/<TYPE>.<ext>`; the database (`student_documents`) records the type, original path in the ZIP, size, SHA-256 and storage key.
- On finalise every student gets their own folder, `STORAGE_DIR/students/<STU-code>/<TYPE>.<ext>`; versions replaced by a later import are kept under `_replaced/`. Cancelling a batch deletes its staging folder.
- Replacing a document on the student edit form (`POST /student-registrations/:id/documents`) deletes the old one for good (record and file); the new file waits under `_staging/` until the database change commits, so a failed request leaves the old document in place.
- Files are only served through the API (`GET /students/:id/documents/:documentId/file`, permission `imports.view`), as downloads, and every download is audited. Back up `STORAGE_DIR` together with the database.
