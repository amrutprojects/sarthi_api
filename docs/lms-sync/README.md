# Amrut → LMS student sync (M1)

Amrut is a tenant of the LMS. This module sends Amrut's approved students to the LMS tenant API
(`POST /tenant/v1/students`) with the tenant API key, follows each record until the LMS learner exists, and keeps a
**sync flag** per student. The admin endpoints for the Panel screens are in [admin-api.md](admin-api.md).

- Code: `src/modules/lms-sync/` (client, payload mapper, worker, runtime/poller, admin service and routes).
- Tables: `student_lms_link`, `lms_sync_state` (migration `1798510000000-StudentLmsLink`).
- LMS contract: lms-api `docs/contracts/multi-tenant/tenant-api.md`, `docs/integration/tenant-api-guide.md`,
  `docs/openapi/tenant-v1.json`.

**The student import is not changed.** The worker only *reads* the `students` table. New imports, registration
approvals and edits reach the LMS because the worker polls the table, not because the import calls it.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `LMS_SYNC_ENABLED` | `false` | Off = no call to the LMS at all. The screens still show the flags; "Push" and "Retry" only queue |
| `LMS_EXTERNAL_BASE_URL` | – | LMS API host (the client adds `/tenant/v1`) |
| `LMS_TENANT_API_KEY` | – | Tenant key issued by the LMS Super Admin for the Amrut tenant, scopes `students.write` and `students.read` |
| `LMS_TENANT_CODE` | – | Tenant code the LMS gave the Amrut tenant, stored on each link (`student_lms_link.lmsTenantCode`) |
| `LMS_SYNC_INTERVAL_SECONDS` | `60` | Pause between automatic cycles |
| `LMS_SYNC_BATCH_SIZE` | `100` | Records per `POST /students` (LMS accepts 1–200) |
| `LMS_HTTP_TIMEOUT_MS` | `15000` | Timeout of one LMS call |

**Nothing is preset.** The base URL, the tenant key and the tenant code are entered by hand when the Amrut tenant is
created in the LMS and the link is set up; there is no default value, no seeded key and no seeded link row. While
`LMS_SYNC_ENABLED=false` they may be empty (no tenant code: the screens show every student as `NOT_SYNCED` and
"Push to LMS" answers `409 LMS_TENANT_NOT_CONFIGURED`). With `LMS_SYNC_ENABLED=true` the API refuses to start
unless all three are set; the error names the missing variables, never a value.

The key is **server-side only**. It is read from the environment (inject it from the secret manager outside
development), sent only in the `X-Api-Key` header, and is never logged, stored, returned by an endpoint or sent
to a browser. The logger also redacts `x-api-key` and `apiKey` fields.

## Which students are sent

Eligible = `status = 'RECEIVED'` (finalised from an approved import, or an approved registration), `isActive`,
not deleted. A cycle picks an eligible student when:

1. it has no link yet (new), or
2. its link is `PENDING` and due (manual push, retry, or the LMS was down earlier), or
3. `students.updatedAt` (kept current by a database trigger) is newer than the one last evaluated **and** the
   checksum of the payload changed. A row touched without a change to the sent fields is not sent again.

A `PENDING` link whose student is no longer eligible becomes `FAILED` / `NOT_ELIGIBLE`.

## What is sent

`external_student_id = students.id` (never changes, never reused) and `source_record_id = students.code`, plus
names, email, mobile, date of birth, gender, marital status, permanent address, landmark, district, taluka,
division, PIN, alternate contacts, course centre, technology (track code, else the source value), qualification
fields, approval status and date, scheme, submission date, evidence reference, declaration, and document
**flags** (`documents_supplied`, true/false).

**Never sent:** Aadhaar number, caste, religion, disability (status, type, certificate number), current address,
the source's free-text remarks, any document file, the caste-certificate flag. Only the whitelisted keys of
`SENT_FIELDS` (`lms-payload.ts`) can ever appear in a record; unit tests check it.

If an LMS-required field is empty (for example landmark or PIN on older imports), the student is not sent: the
link becomes `FAILED` with `MISSING_REQUIRED_FIELDS` and the field names. Editing the student re-queues it.

`source_updated_at` is `students.updatedAt`, or a later instant whenever that is not newer than the value sent
before (forced re-send, or data changed without a newer `updatedAt`). The checksum (SHA-256 of the record without `source_updated_at`) is stored in `payloadChecksum`.

## The sync flag

| Flag | Meaning | Next |
| --- | --- | --- |
| `NOT_SYNCED` | No link yet (shown for students the worker has not picked up, or while the sync is off) | Automatic |
| `PENDING` | Queued: pushed, retried, or the LMS was unreachable (`nextAttemptAt` = backoff) | Automatic |
| `SENT` | The LMS accepted the record (`lmsRequestId`); the learner is not created yet (`lmsStatus` RECEIVED, PENDING_ALLOTMENT, ALLOTTED, ON_HOLD) | Automatic follow-up |
| `SYNCED` | The LMS learner exists (`lmsStatus` PROVISIONED, `lmsLearnerCode` set) | – |
| `FAILED` | Needs a fix: `lastErrorCode` says what (see below) | Fix, then Retry (or edit the student) |
| `REVIEW` | The LMS suspects a duplicate (`DUPLICATE_SUSPECT`): the same-person / different-person decision | LMS staff / Amrut workflow |

`lastErrorCode` values: `MISSING_REQUIRED_FIELDS`, `LMS_REJECTED_FIELDS` (field codes in `lastErrorDetails`),
`NOT_ELIGIBLE`, `LMS_<status>` (`LMS_INVALID`, `LMS_NOT_APPROVED`, `LMS_FAILED`, `LMS_REJECTED`, `LMS_WITHDRAWN`),
`LMS_DUPLICATE_SUSPECT`, an LMS error code of a refused call (`SCHEMA_INVALID`, `UNEXPECTED_FIELD`, …) and, on a
`PENDING` row, the reason it is waiting (`LMS_UNREACHABLE`, `LMS_TIMEOUT`, `SERVICE_UNAVAILABLE`, `HTTP_5xx`,
`INTAKE_QUOTA_EXCEEDED`, `RATE_LIMITED`, `EXTERNAL_KEY_INVALID`). Error details hold field names and codes only.

## One cycle

1. `PENDING` links of students that are no longer eligible → `FAILED` / `NOT_ELIGIBLE`.
2. **Send** in batches of `LMS_SYNC_BATCH_SIZE`: one `POST /tenant/v1/students` per batch with
   `Idempotency-Key = amrut-sync-<sha256 of the records>`. Accepted → `SENT`; listed in `rejected` → `FAILED`.
3. **Follow** `SENT` links: `GET /students/requests/{intake_request_id}` (and `GET /students/{id}` for the learner
   code of a provisioned record).
4. **Reconcile**: `GET /students?updated_since=<cursor>` page by page; the cursor (largest `updated_at` seen,
   minus 1 ms) is kept in `lms_sync_state`. Statuses are applied by `external_student_id`.

Only one cycle runs at a time across API instances (PostgreSQL advisory lock). The poller starts with the API when
the sync is enabled; "Push" and "Retry" start a cycle at once.

## Failures and recovery

- **Inside one call:** timeout; network errors, `429`, `500`, `502`, `503`, `504` are retried up to 4 times with
  exponential backoff and jitter (2 s, 4 s, 8 s, 16 s, capped at 30 s), honouring `Retry-After`. The same body and
  Idempotency-Key are sent each time, so a retry can never store a record twice.
- **LMS still down** (or the hourly quota is used up, `Retry-After` longer than 60 s): the batch stays `PENDING`
  with `nextAttemptAt` = max(`Retry-After`, backoff from 30 s up to 30 min) and the cycle stops. The next cycles pick
  the records up when they are due. Nothing is lost and nothing is marked failed because of an outage.
- **`401` / `403`** (key wrong, revoked, missing scope): treated like an outage (records stay queued, error logged
  with the code only), so fixing the key recovers without manual retries.
- **Other `4xx`** (`400`, `409`, `413`): the batch is `FAILED` with the LMS code; fix, then Retry.

## Same student twice, edits, duplicates

- The LMS upserts by `(tenant, external_student_id)`, and `external_student_id` is `students.id`, so the same
  student always maps to one LMS record. An unchanged student is never sent again automatically. A manual push
  (or a retry) of an unchanged student is sent with a newer `source_updated_at`, so it is a new call: the LMS skips
  it as unchanged when it already holds the record, or validates it again when it was invalid (never a replay of an
  old rejection). A send that never got an answer is retried with the same body and Idempotency-Key.
- An edit in Amrut changes the checksum and is sent with a newer `source_updated_at`; the LMS refreshes its
  working copy.
- `REVIEW` uses Amrut's existing same-person / different-person workflow (out of scope of this module).

## Not covered here

- The LMS tenant API does not return an LMS learner id today, only `learner_code`; `lmsLearnerId` stays empty
  until it does.
- One tenant per Amrut installation (`LMS_TENANT_CODE`). Mapping individual students to several tenants (N-8) would
  need a tenant column on `students`, which this phase does not add (the students table is not changed).
- The key is an environment variable, not an encrypted database value.

## Tests

- Unit: `tests/unit/lms-sync/` — payload mapping (restricted fields never present, whitelist only), checksum,
  Idempotency-Key, backoff and jitter, Retry-After, retries, timeouts, key never in an error.
- DB: `tests/integration/lms-sync/lms-sync-worker.test.ts` against a fake LMS (`tests/helpers/fake-lms.ts`): one send
  per student, replayed push, edit → resend, touch without change → no send, LMS down / connection dropped / quota →
  queued and recovered, missing fields, rejected fields + retry, REVIEW / FAILED from reconciliation, NOT_ELIGIBLE,
  advisory lock, keys never in a log line or stored row.
- E2E: `tests/e2e/lms-sync-admin.e2e.test.ts` — the admin endpoints and their permissions.
