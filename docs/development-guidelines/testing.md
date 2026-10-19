# Testing (backend)

See [ADR-0006](../architecture/adr/0006-testing-strategy.md) for the layers.

## Setup

1. Create `.env.test` from `.env.example` with a database whose name contains `test` (e.g. `admin_panel_test`), `NODE_ENV=test`, `BCRYPT_ROUNDS=4`, high rate limits, `LOG_LEVEL=silent`, and its own `STUDENT_*` keys.
2. `npm run db:create` creates it if missing.

## Commands

```bash
npm run test:unit       # no database
npm run test:db         # integration + contract + e2e (rebuilds the test schema from migrations first)
npm test                # everything
npm run test:coverage
```

## Writing tests

- Helpers in `tests/helpers/test-app.ts`: `setupTestApp`, `resetData`, `createUser({ roleCodes })`, `login(email)` (bearer token), `auth(token)`, `superAdmin()`, `createRoleWith(codes)`, `actorWith(codes)`.
- Every protected endpoint: success, 401 without credentials, 403 without the permission, validation (422) and the business conflicts.
- Browser-session behaviour (cookie, CSRF, renewal, logout) is covered in `tests/integration/auth/session-cookie.test.ts`.
- Unit tests mock collaborators at module boundaries (`jest.mock('../../../src/modules/roles-permissions', …)`), never deep internals of other modules.
- Use synthetic data only (`example.invalid` emails, Verhoeff-valid synthetic Aadhaar numbers from `withVerhoeffDigit`).
