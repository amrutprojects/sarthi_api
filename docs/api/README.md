# API standards

The complete, generated contract is served by the running API:

- OpenAPI JSON: `GET /api/v1/openapi.json`
- Swagger UI: `/api/docs`

Both are on by default outside production (`API_DOCS_ENABLED`). Each operation lists its required permission (`x-permissions` and in the description), request schemas, response DTO and error responses.

## Authentication

| Client | How |
|---|---|
| Browser (admin panel) | `POST /api/v1/auth/login` sets the `amrut_session` HttpOnly cookie and returns `csrfToken`. Send requests with credentials; add `X-CSRF-Token: <csrfToken>` on POST/PUT/PATCH/DELETE. `GET /auth/me` returns the token again after a page reload. |
| API client | `POST /api/v1/auth/login` with header `X-Auth-Mode: bearer` returns `accessToken`; send `Authorization: Bearer <token>`. No CSRF header needed. |

## Envelope

```json
{ "success": true, "message": "Users retrieved successfully", "data": [], "meta": { "page": 1, "limit": 10, "total": 0, "totalPages": 1 } }
{ "success": false, "message": "Validation failed", "error": { "code": "VALIDATION_ERROR", "details": [{ "field": "body.email", "message": "Must be a valid email address" }], "requestId": "…" } }
```

`X-Request-Id` is accepted (1–100 letters, digits, `.`, `_`, `-`) or generated, and returned on every response; quote it when reporting a problem.

## Lists

`page` (≥ 1), `limit` (default 10, max 100), `search`, `sortBy` (per-resource whitelist), `sortOrder` (`ASC`/`DESC`), `isActive`. The response `meta` has `page`, `limit`, `total`, `totalPages`.

## Idempotency

`POST /users`, `POST /roles`, `POST /permissions` and `POST /imports/{id}/finalise` accept `Idempotency-Key` (see [ADR-0005](../architecture/adr/0005-idempotency-keys.md)).

## Error codes

`BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `CSRF_INVALID`, `NOT_FOUND`, `ROUTE_NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_IN_PROGRESS`, `SELF_PRIVILEGE_CHANGE`, `PRIVILEGE_ESCALATION`, `PROTECTED_ROLE`, `INTERNAL_ERROR`.

Production responses never include stack traces, SQL errors, tokens or secrets.
