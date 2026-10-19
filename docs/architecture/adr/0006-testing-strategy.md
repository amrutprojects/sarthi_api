# ADR-0006: Test layers

- Status: Accepted
- Date: 2026-10-19
- Applies to: both repositories

## Decision

### Backend (Jest + Supertest)

| Layer | Folder | Database | What it proves |
|---|---|---|---|
| Unit | `tests/unit` | none | Pure logic (validators, crypto, pagination, CSRF) and services with dependencies mocked at module boundaries |
| Integration | `tests/integration/<module>` | isolated test DB | HTTP → service → repository → PostgreSQL per module, including permission and negative authorization cases |
| Contract | `tests/contract` | isolated test DB | Every route documented in OpenAPI; real responses match the documented DTOs |
| E2E | `tests/e2e` | isolated test DB | Whole workflows across modules (e.g. student import: upload → review → second-person finalise → register) |

- Jest projects `unit` and `db`; `npm run test:unit` needs no database.
- The test database is configured in `.env.test`; helpers refuse to run unless its name contains `test`. `globalSetup` drops and recreates the schema from the migrations, which also checks that every migration applies cleanly from scratch.
- Tests never use production data; fixtures are synthetic.

### Frontend (Vitest + React Testing Library)

- Module tests next to the module (`src/modules/<name>/tests`): schemas, forms, screens with the module's API service mocked.
- Cross-cutting tests in `tests/` (e.g. the API client).
- Browser end-to-end tests (Playwright) are not set up yet — see "Open items" in the admin panel README.

## Consequences

- New endpoints need an integration test covering success, 401/403 and validation; critical endpoints also need a contract check.
- CI should run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` in both repositories.
