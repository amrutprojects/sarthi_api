# Creating a backend module

`src/modules/users` is the reference implementation: copy its shape. Example below: a `centres` module.

## 1. Files

```
src/modules/centres/
  centre.entity.ts        TypeORM entity (extends AppBaseEntity)
  centre.repository.ts    Queries for this module's tables only (extends BaseRepository → soft-delete aware)
  centre.service.ts       Business rules, transactions, audit events
  centre.validation.ts    Zod schemas: { params?, query?, body? } per endpoint
  centre.mapper.ts        Entity → DTO (toCentreDto); nothing else leaves the module
  centre.controller.ts    Read validated input, call the service, send ApiResponse
  centre.routes.ts        Paths + authenticate → authorizePermission → validateRequest → [idempotent] → controller
  centre.openapi.ts       documentEndpoint(...) for every route, with the DTO schema
  centre.constants.ts     Module constants (optional)
  index.ts                Public API: service, DTO types, entity (for relations) — no router, no repository
```

Use sub-folders only for genuinely separate workflows (see `students/import` and `students/register`).

## 2. Database

1. Write the entity (table `centres`, columns in camelCase, common fields from `AppBaseEntity`).
2. `npm run migration:create -- src/database/migrations/<timestamp>-Centres` (or `migration:generate` and review). Add partial unique indexes `WHERE "isDelete" = false`, `RESTRICT` foreign keys and the `updatedAt` trigger, as in existing migrations. Write a working `down()`.
3. Register the migration in `src/database/migrations/index.ts` and the entity in `src/database/entities.ts`.
4. `npm run migration:run`.

## 3. Permissions

- Menu-level permissions (`<menu>.view|create|update|delete|approve`) come from `MENUS` in `roles-permissions/permission.constants.ts` — add the menu key there if this is a new menu, then `npm run seed` (Super Admin receives new permissions automatically; give other roles access in the admin panel or in `role.constants.ts` for new installs).
- Every route names its permission: `authorizePermission('centres.view')`. Never rely on the frontend hiding a button.

## 4. Wire it up

- `src/routes.ts`: `apiRouter.use('/centres', centreRouter)`.
- `src/openapi.ts`: `import './modules/centres/centre.openapi'`.
- Other modules that need centres import from `../centres` (the index) only.

## 5. Tests

- `tests/unit/centres/*.test.ts`: service rules with the repository mocked (`jest.mock` of the module's repository and other modules' indexes — see `tests/unit/users/user.service.test.ts`).
- `tests/integration/centres/*.test.ts`: each endpoint — success, 401, 403 for a user without the permission, 422 validation, 404, conflicts, soft delete.
- The contract test fails until every route is documented; add a DTO check for critical endpoints.

## Checklist

- [ ] Entity, migration (with `down()`), registered in both indexes; migration applied
- [ ] Repository only touches this module's tables; soft delete respected
- [ ] Service holds all rules; multi-record writes in one transaction; audit events for sensitive actions
- [ ] Zod schemas for params, query and body; pagination via `listQuerySchema` with whitelisted sort fields
- [ ] Mapper returns DTOs; no entity or ORM relation in any response
- [ ] Routes: `authenticate`, a permission per endpoint, validation, `idempotent` on create/one-off transitions
- [ ] `*.openapi.ts` documents every route; contract test passes
- [ ] `index.ts` exports only what other modules need
- [ ] Permissions seeded; roles updated if needed
- [ ] Unit + integration tests, including negative authorization
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` pass
- [ ] Frontend counterpart planned (see the admin panel's module guide)
