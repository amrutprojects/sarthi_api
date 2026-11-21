# Panel reads of LMS data through `/tenant/v1` (M1)

M1 item: "Amrut reads its LMS data (summary, centres, batches, sessions, trainers) through `/tenant/v1` with its
tenant key, instead of keeping copies." This module (`src/modules/lms-reads`) adds those reads to the Panel API.
It changes nothing that exists: the `lms_*` tables, the `/api/v1/lms/*` masters and their screens stay as they are
(retiring them is the separate G-2 decision, see [g2-lms-tables-mapping.md](g2-lms-tables-mapping.md)).

## Switch and configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `LMS_READS_ENABLED` | `false` | Off: every data route answers `404 LMS_READS_DISABLED` and no call leaves the server. `/status` still answers. |
| `LMS_EXTERNAL_BASE_URL` | — | LMS API host, e.g. `https://lms-api.example.org` (the client adds `/tenant/v1`). Required when on. |
| `LMS_TENANT_API_KEY` | — | Amrut's tenant key, issued once by the LMS Super Admin. Required when on. Server-side only. |
| `LMS_READS_TIMEOUT_MS` | `8000` | Timeout of one LMS call (500–60000). |
| `LMS_READS_CACHE_SECONDS` | `30` | How long an LMS answer is reused, in memory per process (0–600; 0 = no cache). |

Key scopes the reads need on the LMS side: **`stats.read`** (summary, centres, batches, sessions, trainers),
**`delivery.read`** (attendance), **`sessions.read`** (live sessions). The student sync uses the same key with
`students.read` / `students.write`, so one key with all five scopes covers both. A missing scope answers
`503 LMS_KEY_REJECTED` with `details: [{ field: "scope", message: "missing_scope" }, …]`.

The key never leaves the server: it is sent only in the `X-Api-Key` header to the LMS, never in a URL, an error, a log
line, a response or the cache key. Errors keep the LMS's codes and request id, never its message text.

## Endpoints (`/api/v1/lms-reads`, GET only, session required)

| Panel route | LMS read | Permission (any of) | Panel screens it can feed |
| --- | --- | --- | --- |
| `/status` | — (no LMS call) | any code below | feature probe |
| `/summary?entityCode=` | `GET /summary` | `dashboard.view`, `exec.view`, `today.view`, `lms.view` | Dashboard KPIs, Executive, Today |
| `/centres?page&limit&updatedSince&entityCode` | `GET /centres` | `centres.view`, `lms.view` | Training Centres |
| `/batches?…` | `GET /batches` | `batches.view`, `lms.view` | Batches |
| `/sessions?…` | `GET /sessions` | `live.view`, `offline.view`, `online.view`, `lms.view` | Offline / Online Training |
| `/live-sessions?date&centreCode&batchCode&deliveryMode` | `GET /live-sessions` (API-110) | as `/sessions` | Live Training Monitor |
| `/trainers?…` | `GET /trainers` | `trainers.view`, `tot.view`, `lms.view` | Trainers |
| `/attendance?groupBy&dateFrom&dateTo&entityCode` | `GET /attendance` | `attendance.view`, `lms.view` | Attendance |

Permissions are the existing `.view` codes of the Panel screens (no new code, no migration). List queries use the
Panel conventions (`page`, `limit` ≤ 100) and become the LMS's `page` / `page_size`.

`/live-sessions` reads API-110, which is committed on lms-api branch `claude/mt-tenant-integration-ops-*` and not on
lms-api `main` yet: until it is merged and deployed the LMS answers 404, so this route answers `404 LMS_NOT_FOUND`.
All other reads are on lms-api `main`.

## Response shapes

Standard envelope `{ success, status, message, data, meta? }`; lists carry `meta: { page, limit, total, totalPages }`.
Headers: `X-Lms-Fetched-At` (when the LMS produced the answer) and `X-Lms-Cache` (`HIT`, `MISS`, `REVALIDATED`).
The exact schemas are in the OpenAPI document (`LmsSummary`, `LmsCentre`, `LmsBatch`, `LmsSession`, `LmsLiveSessions`,
`LmsTrainer`, `LmsAttendance`, `LmsReadsStatus`; tag "LMS reads").

None of these facts had a Panel endpoint before (the Panel's Delivery / Training / Dashboard screens run on mock
services), so the shapes are new: the LMS wire fields in camelCase, with these choices:

- **Centre** follows the field names of `/lms/reference/centres` where they overlap: `code`, `name`, `districtCode`,
  `districtName`, `centreTypeName`, `isActive`, `sourceUpdatedAt`; plus the LMS `status`.
- **Batch** `{ id, code, entityCode, courseCode, centreCode, centreName, trackCode, startDate, endDate, deliveryMode,
  status, capacity, learnersEnrolled, learnersActive, learnersCompleted, learnersWithdrawn, updatedAt }`.
- **Session** `{ id, batchCode, centreCode, entityCode, title, moduleNo, startsAt, endsAt, deliveryMode, attendanceMode,
  status, trainerCode, attendance: { present, late, absent, excused }, updatedAt }`.
- **Live sessions** `{ asOf, date, items: [{ id, batchCode, centreCode, deliveryMode, trainerCode, trainerName, topic,
  startsAt, endsAt, status, inProgress, enrolled, present, late }] }` (the LMS-internal `lms_entity_id` is dropped).
- **Trainer** `{ id, code, displayName, status, entityCode, centreCodes, batchCodes, updatedAt }` (no phone or e-mail;
  the LMS sends none).
- **Attendance** `{ groupBy, dateFrom, dateTo, items: [{ code, batches, sessionsHeld, present, late, absent, excused,
  selfCheckIns, geoCheckIns, selfies, groupPhotos }] }` (codes only, as the LMS sends them).
- **Summary** `{ tenant, entity, entities, generatedAt, learners, batches, centresActive, trainersActive, attendance:
  { sessionsScheduled, recordsMarked, attended, attendancePercent }, outcomes, byCentre, byTrack, byBatch }`. The
  LMS leaves `learners`, `batches`, `outcomes` and the `by*` rows open-ended, so they are passed through with their
  keys camelCased.

Mapping is tolerant: a missing LMS field becomes `null` (a count `0`, a list `[]`), and unknown LMS fields are
ignored, so additive LMS changes never break a screen.

## Errors

| Panel answer | `error.code` | When |
| --- | --- | --- |
| 404 | `LMS_READS_DISABLED` | `LMS_READS_ENABLED` is off |
| 503 | `LMS_NOT_CONFIGURED` | on, but base URL or key missing (startup also refuses this) |
| 503 | `LMS_TIMEOUT` | no answer within `LMS_READS_TIMEOUT_MS` |
| 503 | `LMS_UNREACHABLE` | DNS / connection failure |
| 503 | `LMS_UNAVAILABLE` | LMS 5xx (`retryAfterSeconds` detail when the LMS sent Retry-After) |
| 503 | `LMS_RATE_LIMITED` | LMS 429 (with `retryAfterSeconds`) |
| 503 | `LMS_KEY_REJECTED` | LMS 401 / 403 (key missing, revoked, expired, tenant inactive, scope missing) |
| 503 | `LMS_BAD_ANSWER` | the LMS answer is not JSON |
| 404 | `LMS_NOT_FOUND` | LMS 404 (multi-tenant switch off on the LMS, unknown `entityCode`, route not deployed) |
| 422 | `LMS_QUERY_REJECTED` | LMS 400 / 422 |
| 422 | `VALIDATION_ERROR` | the Panel query is invalid (checked before any LMS call) |

`error.details` carries `lmsCode`, `lmsRequestId` (quote it to the LMS team) and the LMS field codes.

## Client behaviour (`tenant-read-client.ts`)

- One timeout per call, no retry loop (a screen waits on it); errors are never cached.
- Cache per path + query (keys sorted). Concurrent identical reads share one call.
- ETag / If-None-Match: when the LMS sends an `ETag`, a stale entry is revalidated and a `304` renews it. The tenant
  API answers `Cache-Control: no-store` without an ETag today, so only the TTL applies until the LMS adds ETags.
  The short server-side TTL is the Panel's own choice for screen load; set `LMS_READS_CACHE_SECONDS=0` to disable it.

## Relation to the student sync (`src/modules/lms-sync`)

- Same configuration: `LMS_EXTERNAL_BASE_URL` and `LMS_TENANT_API_KEY` are the sync's variables; this module adds only
  `LMS_READS_ENABLED`, `LMS_READS_TIMEOUT_MS` and `LMS_READS_CACHE_SECONDS`. The startup check refuses
  `LMS_SYNC_ENABLED` or `LMS_READS_ENABLED` without both (the sync also needs `LMS_TENANT_CODE`). None of these values is
  preset: all are entered by hand when the Amrut tenant and its LMS link are set up.
- Separate small client: the sync's `lms-client.ts` is for writes (typed student methods, retries with backoff);
  a screen read must fail fast and wants a cache. The read client reuses the sync's `tenantBaseUrl()` and
  `parseRetryAfter()` (exported from the lms-sync module index).

## Tests

- Unit: `tests/unit/lms-reads/*` (client: caching, ETag, timeouts, error mapping, key never leaked; mappers; service).
- Route: `tests/integration/lms-reads/lms-reads.routes.test.ts` with the LMS faked in process
  (`tests/helpers/fake-lms-reads.ts`), on the isolated test database from `.env.test`.
