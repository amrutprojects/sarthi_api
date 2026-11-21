# LMS sync — admin API (for the Panel screens)

Base: `/api/v1/lms-sync`. Session as for every admin route (cookie or bearer, CSRF as usual). Responses use the
standard envelope `{ success, status, message, data, meta? }`; errors `{ success: false, status, message, data: null,
error: { code, details?, requestId } }`. Also in the OpenAPI document under the tag **LMS sync**
(`/api/v1/openapi.json`). How the sync works: [README.md](README.md).

| Method and path | Permission | Purpose |
| --- | --- | --- |
| `GET /summary` | `imports.view` or `candidates.view` | Flag counts (header chips) |
| `GET /students` | `imports.view` or `candidates.view` | Student register with the sync flag column and filter |
| `GET /students/:id` | `imports.view` or `candidates.view` | Sync detail of one student |
| `POST /students/push` | `imports.update` | "Push to LMS" (one or many) |
| `POST /students/retry` | `imports.update` | "Retry" failed students |
| `POST /run` | `imports.update` | Run one cycle now (ops) |

Flags: `NOT_SYNCED`, `PENDING`, `SENT`, `SYNCED`, `FAILED`, `REVIEW` (meanings in the README). No personal data
beyond code and name is returned; the register's own endpoints show the rest (masked).

## `GET /summary`

```json
{ "data": { "tenantCode": "AMRUT", "syncEnabled": false, "eligible": 2,
            "byStatus": { "NOT_SYNCED": 1, "PENDING": 0, "SENT": 0, "SYNCED": 0, "FAILED": 1, "REVIEW": 0 } } }
```

Counts cover eligible students only (approved, active, not deleted). `syncEnabled: false` → show a banner
"LMS sync is switched off" (actions still queue).

## `GET /students`

Query: `page` (1), `limit` (25, max 200), `syncStatus` (one value or comma-separated, e.g. `FAILED,REVIEW`;
case-insensitive), `scope` (`eligible` default | `all`), `search` (code or name), `centre` (centre code),
`errorCode` (exact `lastErrorCode`).

```json
{ "data": [ {
    "studentId": "uuid", "code": "STU-000123", "firstName": "Asha", "lastName": "Example",
    "centreCode": "NAG", "trackCode": "T03", "studentStatus": "RECEIVED", "eligible": true,
    "syncStatus": "FAILED", "lmsStatus": "INVALID", "lmsLearnerCode": null, "attempts": 2,
    "lastErrorCode": "LMS_REJECTED_FIELDS", "lastSentAt": "2026-11-21T07:02:11.481Z",
    "lastSyncedAt": null, "nextAttemptAt": null } ],
  "meta": { "page": 1, "limit": 25, "total": 1, "totalPages": 1 } }
```

Sorted by the latest sync activity first. A student without a link shows `syncStatus: "NOT_SYNCED"`,
`attempts: 0` and nulls.

## `GET /students/:id`

```json
{ "data": {
    "studentId": "uuid", "code": "STU-000123", "firstName": "Asha", "lastName": "Example",
    "studentStatus": "RECEIVED", "eligible": true, "tenantCode": "AMRUT", "syncEnabled": true,
    "syncStatus": "SYNCED", "lmsLearnerId": null, "lmsLearnerCode": "AMK-L-0000123",
    "lmsRequestId": "5f0c2a8e-…", "lmsStatus": "PROVISIONED", "lmsReasonCodes": [],
    "attempts": 1, "lastErrorCode": null, "lastErrorDetails": [],
    "queuedAt": "…", "lastSentAt": "…", "lastCheckedAt": "…", "lastSyncedAt": "…", "nextAttemptAt": null,
    "linkCreatedAt": "…",
    "payload": { "fields": ["external_student_id", "source_record_id", "first_name", "…"],
                 "missingRequiredFields": [], "checksum": "…64 hex…", "lastSentChecksum": "…",
                 "changedSinceLastSend": false } } }
```

- `lastErrorDetails`: `[{ "field": "pin_code", "code": "format" }]` (names and codes only, never values).
- `payload.missingRequiredFields`: LMS-required fields empty in Amrut (`landmark`, `pin_code`, …). Show them as
  "fill these in to sync".
- `payload.changedSinceLastSend: true` with `syncStatus` `SYNCED` = an edit is waiting for the next cycle.
- `404` for an unknown or deleted student.

## `POST /students/push`

Body: `{ "studentIds": ["uuid", …] }` (1–500).

```json
{ "data": { "syncEnabled": true, "queued": ["uuid-a"],
            "skipped": [ { "studentId": "uuid-p", "reason": "NOT_ELIGIBLE" } ] } }
```

Eligible students become `PENDING` (attempts and error reset) and are sent in the next cycle, started at once when
the sync is on, even if unchanged. `reason`: `NOT_ELIGIBLE` (not approved, inactive) or `NOT_FOUND`.
Audited as `lms_sync.push`.

## `POST /students/retry`

Body: `{ "studentIds": ["uuid", …] }` or `{}` for every failed student.

```json
{ "data": { "syncEnabled": true, "queued": ["uuid-b"] } }
```

Only `FAILED` links move back to `PENDING`; others are ignored (not listed). Audited as `lms_sync.retry`.

## `POST /run`

No body. Runs one cycle and answers its counts:

```json
{ "data": { "ran": true, "sent": 3, "rejected": 0, "failed": 0, "deferred": 0, "unchanged": 1,
            "missingFields": 1, "notEligible": 0, "followed": 2, "reconciled": 4, "lmsUnavailable": false } }
```

`ran: false, reason: "locked"` = another cycle was running. `409 LMS_SYNC_DISABLED` while the sync is off.
Audited as `lms_sync.run`.

## Screen hints

- Register: a "LMS sync" column (flag chip) and a multi-select filter (`syncStatus`), plus a bulk "Push to LMS".
- Detail: flag, LMS learner code, LMS status and reason codes, last error with field codes, missing fields,
  attempts, timestamps; buttons "Push to LMS" and (for `FAILED`) "Retry".
- Buttons need `imports.update`; hide them otherwise.
