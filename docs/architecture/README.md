# Architecture overview

## Context

Two repositories, deployed independently:

- **sarthi-api** (this repository): the REST API and the only component that talks to PostgreSQL.
- **sarthi-admin**: the React admin panel, a static single-page app that calls this API.

```
Browser ──HTTPS──> Admin panel (static files)
   │
   └──HTTPS, cookie session──> API (Express) ──> PostgreSQL
```

## Request pipeline

Every request passes the same chain (`src/app.ts`, then each route):

1. `request-id` — accepts a safe `X-Request-Id` or generates one; returned on the response and written to every log line and audit entry.
2. `pino-http` — structured access log (no bodies, no secrets).
3. `helmet`, `cors` (allow-list), global rate limit, JSON body parser (100 kB).
4. Route: `authenticate` → `authorizePermission(code)` → `validateRequest(schemas)` → optional `idempotent` → controller.
5. Controller → service (business rules, transactions) → repository (persistence).
6. `errorHandler` turns every error into the error envelope; 5xx details only go to the log.

Authorization runs **before** validation, so a caller without the permission learns nothing about the request shape.

## Layers inside a module

| Layer | Responsibility | Must not |
|---|---|---|
| `*.routes.ts` | Paths, middleware order, permission per endpoint | contain logic |
| `*.controller.ts` | Read the validated request, call one service method, send the envelope | touch the database |
| `*.service.ts` | Business rules, workflows, transactions, audit events | know about `req`/`res` beyond passing `req` to audit |
| `*.repository.ts` | Queries for the module's own tables (soft-delete aware) | be imported by another module |
| `*.validation.ts` | Zod schemas for params, query and body | |
| `*.mapper.ts` | Entity → API DTO (no ORM objects leave the module) | |
| `*.openapi.ts` | Endpoint documentation using the validation schemas and DTOs | |
| `*.entity.ts` | TypeORM mapping of the module's tables | |
| `index.ts` | Public API for other modules: services, types, entities for relations | export routers or repositories |

Modules depend on each other only through `index.ts` ([ADR-0002](adr/0002-module-boundaries.md)). The composition roots (`src/routes.ts`, `src/openapi.ts`, `src/database/entities.ts`) are the only places that import module internals.

## Data rules

- Every application table has `id` (UUID), `createdAt`, `updatedAt`, `isDelete`, `isActive` ([database conventions](../database/README.md)).
- Soft delete everywhere; unique constraints are partial indexes over non-deleted rows.
- Multi-record changes run in one transaction inside the service.
- `audit_logs` is append-only (a trigger blocks UPDATE and DELETE).

## Authentication and authorization

- Browsers: HttpOnly `SameSite=Strict` session cookie; state-changing requests also send `X-CSRF-Token` ([ADR-0003](adr/0003-browser-sessions.md)).
- API clients: `Authorization: Bearer <token>` from `POST /auth/login` with `X-Auth-Mode: bearer`.
- Every request re-loads the user: deactivating or deleting an account takes effect immediately.
- Permissions come from the database (users → roles → permissions), never from the token. Every protected endpoint names its permission; deny by default.
- Anti-escalation rules live in `roles-permissions` (`rbac.service.ts`, `role-assignment.service.ts`): no self role changes, no granting what you do not hold, Super Admin protected.

## Cross-cutting

- **API contract** — OpenAPI generated from the Zod schemas ([ADR-0004](adr/0004-openapi-from-zod.md)).
- **Idempotency** — `Idempotency-Key` on create/finalise endpoints ([ADR-0005](adr/0005-idempotency-keys.md)).
- **Health** — `/health/live` (process) and `/health/ready` (database + migrations).
- **Shutdown** — SIGTERM/SIGINT stop accepting connections, finish in-flight requests, close the pool (10 s limit).
- **Background work** — not yet; see [ADR-0010](adr/0010-background-jobs.md).

## Decision records

| ADR | Decision |
|---|---|
| [0001](adr/0001-repositories-and-feature-modules.md) | Two repositories; feature modules as the primary unit |
| [0002](adr/0002-module-boundaries.md) | Public module APIs, checked in CI |
| [0003](adr/0003-browser-sessions.md) | HttpOnly cookie sessions + CSRF; bearer for API clients |
| [0004](adr/0004-openapi-from-zod.md) | OpenAPI generated from Zod validation schemas |
| [0005](adr/0005-idempotency-keys.md) | Idempotency keys for retryable writes |
| [0006](adr/0006-testing-strategy.md) | Test layers: unit, integration, contract, e2e |
| [0009](adr/0009-typeorm-and-database-conventions.md) | Keep TypeORM; database naming conventions |
| [0010](adr/0010-background-jobs.md) | Background jobs deferred (open decision) |

ADR numbers are shared with the admin panel repository (0007 and 0008 are frontend decisions).
