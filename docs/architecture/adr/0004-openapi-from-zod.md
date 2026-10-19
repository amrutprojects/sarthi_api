# ADR-0004: OpenAPI generated from the Zod validation schemas

- Status: Accepted
- Date: 2026-10-19

## Context

The brief requires OpenAPI documentation of parameters, schemas, permissions and errors, plus contract tests. Hand-written specs drift from the code.

## Decision

- Use `@asteasolutions/zod-to-openapi`. Each module documents its endpoints in `<module>.openapi.ts` with `documentEndpoint()` (`src/shared/openapi/registry.ts`), passing the **same Zod schemas** that `validateRequest` uses, the response DTO schema, the permission and the possible error codes.
- `documentEndpoint` adds the standard envelope, security schemes (cookie and bearer), `x-permissions`, error responses and an Idempotency-Key header where applicable.
- `src/openapi.ts` builds the document. It is served at `/api/v1/openapi.json` and as Swagger UI at `/api/docs` (disabled in production unless `API_DOCS_ENABLED=true`).
- `tests/contract/openapi.contract.test.ts` fails when an Express route is undocumented or a documented route does not exist, and checks real responses of key endpoints against the documented DTO schemas.

## Consequences

- A new endpoint is not done until it is documented (the contract test enforces it).
- Response DTO schemas are maintained next to the mapper; the contract test catches mismatches for the endpoints it covers — extend it when adding critical endpoints.
