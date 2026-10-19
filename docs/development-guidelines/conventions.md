# Coding conventions (backend)

## Naming

| Thing | Convention | Example |
|---|---|---|
| Files | kebab-case with a role suffix | `user.service.ts`, `role-assignment.service.ts`, `import-batch.entity.ts` |
| Classes, types, interfaces | PascalCase | `UserService`, `PublicUser` |
| Functions, variables, singletons | camelCase | `userService`, `toPublicUser` |
| Constants | UPPER_SNAKE_CASE | `ROLE_CODES`, `BATCH_STATUS` |
| Permission codes | `<module>.<action>` lower-case | `users.view`, `imports.approve` |
| Role codes | UPPER_SNAKE_CASE | `SUPER_ADMIN` |
| Error codes | UPPER_SNAKE_CASE | `VALIDATION_ERROR`, `CSRF_INVALID` |
| Tables / columns | snake_case plural / camelCase | `role_permissions."roleId"` |

## TypeScript

- `strict` on; no `any` (ESLint error) — use `unknown` and narrow.
- `import type` for type-only imports (enforced).
- No circular dependencies between modules; import other modules only through their `index.ts`.

## HTTP

- Prefix `/api/v1`. Breaking changes need a new version or a backward-compatible transition (add fields, do not rename or remove).
- Success: `{ success: true, message, data, meta? }`. Error: `{ success: false, message, error: { code, details?, requestId } }`.
- Status codes: 200 read/update, 201 create, 400 malformed input, 401 not authenticated, 403 not permitted or CSRF, 404, 409 conflict/state, 422 validation, 429 rate limited, 500 (generic message), 503 not ready.
- Lists: `page`, `limit` (≤ 100; ≤ 200 for import rows), `search`, whitelisted `sortBy`, `sortOrder`.

## Errors and logging

- Throw `AppError` (`shared/errors/app-error.ts`) for expected failures; let unexpected errors reach the error handler.
- Never put passwords, tokens, Aadhaar numbers or other secrets in error messages, logs or audit details. Pino redacts known fields; do not rely on it alone.
- Sensitive administrative actions write an audit event (`auditService.record` / `recordInTx`).

## Comments

Explain business decisions and non-obvious rules (why), not what the code obviously does.

## Formatting and commits

- Prettier (`npm run format`), ESLint (`npm run lint`). Line endings LF (`.gitattributes`).
- Commit messages: imperative summary line, body explaining why. One concern per commit; formatting-only changes in their own commit.
