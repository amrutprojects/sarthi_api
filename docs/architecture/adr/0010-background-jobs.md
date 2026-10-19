# ADR-0010: Background jobs — deferred (open decision)

- Status: Proposed
- Date: 2026-10-19

## Context

The brief asks for background workers for long-running imports, exports and integration jobs. Today the student import validates the uploaded file inside the HTTP request. With the current limits (20 MB, 50,000 rows) validation completes within the request in testing, but large files will hold a connection and a request slot for many seconds, and integrations with the MahaAmrut API and the LMS (spec INT-004, INT-012) will need retries and scheduling.

## Options

1. **pg-boss** (PostgreSQL-backed queue): no new infrastructure, transactional enqueue, retries and scheduling. Fits the current stack.
2. **BullMQ + Redis**: higher throughput, needs Redis in every environment.
3. Keep synchronous processing with tighter limits.

## Proposal

Adopt option 1 when the first job beyond file validation is built: a `src/jobs/` folder with one worker per job type, started by a separate `npm run worker` process; the import upload would store the file, create the batch as `IMPORT_PENDING` and enqueue validation (the batch states already model this).

## Open questions for the team

- Expected peak file size and rows per import.
- Whether a separate worker process is acceptable in the hosting environment.
