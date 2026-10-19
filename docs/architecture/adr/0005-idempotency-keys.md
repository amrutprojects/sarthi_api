# ADR-0005: Idempotency keys for retryable writes

- Status: Accepted
- Date: 2026-10-19

## Context

A create request can succeed on the server while the response is lost (timeout, network drop). Retrying then creates a duplicate or fails with a confusing conflict.

## Decision

- Endpoints that create records or perform one-off transitions accept an optional `Idempotency-Key` header (8–100 characters): `POST /users`, `POST /roles`, `POST /permissions`, `POST /imports/:id/finalise`.
- `shared/idempotency/idempotency.middleware.ts` stores, per user and key, a hash of method + path + body and — once finished — the status and response body (status < 500). Retries with the same key and body get the stored response (`Idempotent-Replayed: true`); a different body is `422 IDEMPOTENCY_KEY_REUSED`; a retry while the first is running is `409 IDEMPOTENCY_IN_PROGRESS`. Rows expire after 24 hours.
- Uploads (`POST /imports`) are already idempotent by file checksum; updates (`PATCH`/`PUT`) are naturally idempotent.
- Clients generate one key per user action (the admin panel: one per open "Create" dialog) and reuse it for retries of that action.

## Consequences

- One extra table write per keyed request.
- Responses are stored as JSON; never use the middleware on endpoints that return secrets.
