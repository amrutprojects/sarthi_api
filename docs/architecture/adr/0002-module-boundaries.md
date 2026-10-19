# ADR-0002: Public module APIs, checked automatically

- Status: Accepted
- Date: 2026-10-19

## Context

Feature modules only stay independent if they cannot reach into each other's internals. Before this change, `users` used the `roles-permissions` repository directly and `auth` used the `users` repository, so persistence rules of one module could be bypassed by another.

## Decision

- Each module has an `index.ts` that is its **public API**: services, DTO types, constants and entities needed for relations. Repositories, controllers, validation schemas and routers are private.
- Code in `src/modules/A` may import from `src/modules/B` only through `src/modules/B` (its index). Inside a module, any relative import is allowed.
- Composition roots may import module internals: `src/routes.ts` (routers), `src/openapi.ts` (API docs), `src/database/entities.ts` (entity registry). Routers are not exported from indexes because that creates import cycles with middleware.
- Writes to another module's tables go through that module's service. Example: user role assignments are owned by `roles-permissions` and changed via `roleAssignmentService`; `auth` reads credentials via `userService.findForLogin`.
- `scripts/check-boundaries.mjs` enforces the rule and runs in `npm run lint`.

## Consequences

- Renaming or reorganising a module's internals cannot break other modules as long as its index is kept.
- Cycles between indexes are possible in principle; keep indexes free of side effects (no routers, no app wiring) and import entities in the registry directly.
