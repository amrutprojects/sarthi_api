# Approval of the student forms of IPP

Student forms come from IPP (the 3 Month Internship Placement Program portal, a separate project with its own database). Its Auditor approves each
form and sends batches here; the officers decide here; every decision goes back to IPP. How the two servers talk (signatures, messages, retries) is
the contract in IPP's repository: `ipp_backend/docs/SARTHI_LINK.md`. This file describes Sarthi's side.

## Who decides what

| Stage | Who | Approve → | Reject (reason required) → |
|---|---|---|---|
| `DIVISION` | Divisional Officer (only the districts assigned to the user) | `COEP` | `AUDITOR` (back in IPP) |
| `COEP` | COEP (all districts) | `HEAD_OFFICE`, or `SUPER_ADMIN` while Head Office is off | `DIVISION` |
| `HEAD_OFFICE` | Head Officer, while Head Office approval is on | `APPROVED` (final) | `COEP` |
| `SUPER_ADMIN` | Super Admin, while Head Office approval is off | `APPROVED` (final) | `COEP` |

- A rejection goes back one level only. The officer there decides again: approve, or reject one level further. Other students of the batch go on.
- `AUDITOR` = back with the IPP Auditor; IPP sends the corrected form again (`RESUBMIT` → `DIVISION`).
- Nobody decides twice: a decision is made on the stage the application is at now (row lock); another stage → 409.
- What a user may decide comes from the permissions `ipp-approvals.division-officer`, `.coep`, `.head-office` — except for the roles `SUPER_ADMIN`
  and `SUMAGO_SUPER_ADMIN`, which hold every permission: they read everything and decide **only** at `SUPER_ADMIN`.
- What a user sees: a Divisional Officer the applications of batches of their districts; COEP what has reached COEP at least once; the Head Officer
  what has reached the final level at least once; Super Admin, and a user with only `ipp-approvals.view`, everything (read-only). Someone with more
  than one of these permissions sees all of what each allows. What a user may not see answers 404.
- The switch "Head Office approval" (panel_settings `ipp.head_office_approval`, default on). Changing it moves everything waiting at the other final
  stage, in the same transaction (event `MOVED`, decision `MOVE` to IPP).

## Data

`ipp_batches`, `ipp_applications` (snapshot of the form, the documents' list, the stage, `reached` = highest level so far, `lastSeq`),
`ipp_approval_events` (append-only), `ipp_decisions` (outbox to IPP), `ipp_messages` (ids of IPP's messages already done), `user_districts`.

Events: `RECEIVED`, `RESUBMITTED`, `CORRECTED`, `APPROVED`, `REJECTED`, `MOVED`.

## API (`/api/v1/ipp-approvals`, session + CSRF as everywhere)

Types: `Stage = 'AUDITOR' | 'DIVISION' | 'COEP' | 'HEAD_OFFICE' | 'SUPER_ADMIN' | 'APPROVED'`. `stageLabel`: With IPP Auditor, With Divisional
Officer, With COEP, With Head Office, With Super Admin, Final approved.

| | Permission | |
|---|---|---|
| `GET /summary` | `ipp-approvals.view` | `{ stages: Stage[] (the ones I decide), districts: { id, name }[] \| null (null = not limited), headOfficeEnabled, toDecide, sentBack (waiting for me after a rejection), counts: Record<Stage, number> (of what I see) }` |
| `GET /applications` | view | list (below) |
| `GET /applications/:id` | view | detail (below) |
| `GET /applications/:id/documents/:code` | view | the file, fetched from IPP and streamed (`private, no-store`, nosniff, attachment); 404 no file; 502 `IPP_UNAVAILABLE`; audited |
| `POST /approve` | any stage permission | body `{ ids: uuid[] }` (1–500, unique) → `{ approved, skipped, applications: { id, stage, stageLabel }[] }`; not mine to decide now = skipped |
| `POST /batches/:id/approve` | any stage permission | all applications of the batch that are mine to decide now → same answer |
| `POST /applications/:id/approve` | any stage permission | one → detail; not mine / other stage → 409 `NOT_YOURS_TO_DECIDE` |
| `POST /applications/:id/reject` | any stage permission | body `{ reason }` (3–500 after trim) → detail; same 409 |
| `GET /batches` · `GET /batches/:id` | view | batches (below) |
| `GET /districts` | view or `ipp-officers.view` | `{ id, name, code }[]` active districts, for filters and the officers' page |
| `GET /head-office` | view or `settings.view` | `{ enabled, updatedAt, updatedBy }` (`updatedBy` = the user's name; both null until it is changed for the first time) |
| `PUT /head-office` | `settings.update` | body `{ enabled }` → the same + `moved` (how many applications changed hands) |
| `GET /officers` | `ipp-officers.view` | `{ officers: { id, name, email, isActive, districts: { id, name }[] }[], withoutOfficer: { id, name, waiting }[] }` — users whose roles (other than SUPER_ADMIN / SUMAGO_SUPER_ADMIN) hold `ipp-approvals.division-officer`; `withoutOfficer` = districts with applications at DIVISION and no active officer |
| `PUT /officers/:userId/districts` | `ipp-officers.update` | body `{ districtIds: uuid[] }` (0–200, replaces) → the officer; a newly added district that is unknown or inactive 422 (one the officer has already is kept, even when inactive now); not a Divisional Officer 409 |
| `GET /link` | `settings.view` | `{ enabled, configured, host \| null, lastSentAt, lastReceivedAt, pending, failed, items: { id, application: { id, registrationId, name }, action, from, to, status: 'PENDING' \| 'FAILED', attempts, nextAttemptAt, lastError, createdAt }[] }` (pending and failed, oldest first, at most 100) |
| `POST /link/retry` | `settings.update` | body `{ ids?: uuid[] }` (none = all failed) → `{ retried }` |
| `POST /link/test` | `settings.update` | calls IPP's ping → `{ ok, message }` (200 also when it fails) |

Not configured (`IPP_LINK_ENABLED` off): reading and deciding work, decisions wait; documents answer 503 `LINK_NOT_CONFIGURED`.

**List** `GET /applications?page&limit (≤100)&search&view&stage&batchId&districtId&sortBy=stageUpdatedAt|name|registrationId&sortOrder`
`view` = `TO_DECIDE` (default; mine to decide now) · `SENT_ON` (I can see it and it is above my levels, APPROVED included) · `SENT_BACK` (below my
levels, last moved by a rejection) · `ALL`. `search` = name, registration id, mobile or email.

```ts
interface ApplicationRow {
  id: string; registrationId: string; registrationNumber: string | null; name: string; mobile: string; email: string;
  district: { id: string; name: string };      // of the batch
  category: string | null; centre: string | null; technology: string | null;
  stage: Stage; stageLabel: string; stageUpdatedAt: string;
  batch: { id: string; code: string; name: string };
  documents: { uploaded: number; verified: number };
  lastEvent: { event: string; from: Stage | null; to: Stage; reason: string | null; by: string; role: string | null; at: string } | null;  // latest that is not CORRECTED
  canDecide: boolean;                          // by me, now
}
interface ApplicationDetail extends ApplicationRow {
  aadhaarMasked: string | null; formDistrict: string | null; submittedAt: string;
  auditor: { approvedAt: string | null; by: string | null };
  fields: { key: string; step: 1 | 2; labelEn: string; labelMr: string; type: string; text: string }[];
  documentList: { code: string; name: string; nameMr: string | null; required: boolean; kind: 'DOCUMENT' | 'VIDEO';
    file: { name: string; mime: string; size: number; uploadedAt: string } | null; verified: boolean; verifiedAt: string | null; verifiedBy: string | null }[];
  edits: { at: string; by: string | null; changes: { key: string; label: string; from: string; to: string }[] }[];
  history: { event: string; from: Stage | null; to: Stage; reason: string | null; by: string; role: string | null; at: string }[];  // newest first
  approveTo: { stage: Stage; label: string } | null;   // where my approval / rejection sends it; null = not mine to decide
  rejectTo: { stage: Stage; label: string } | null;
}
interface BatchRow {
  id: string; code: string; name: string; district: { id: string; name: string }; centre: { code: string; name: string };
  size: number; startDate: string | null; endDate: string | null; deliveryMode: 'OFFLINE' | 'ONLINE' | 'BLENDED'; technology: string | null;
  sentBy: string | null; receivedAt: string; students: number; stages: Record<Stage, number>; toDecide: number;
}
```

`GET /batches?page&limit&search (code, name, centre)&districtId&sortBy=receivedAt|name&sortOrder`; a batch is seen when one of its applications is;
`students` and `stages` count the applications the user sees.

## How the rules are read

**Rights**
- `summary.stages`, `canDecide` and `TO_DECIDE` follow the switch: while Head Office approval is off the Head Officer decides nothing, while it is on
  the Super Admin decides nothing. `summary.districts` is the list (`[]` when none is assigned) for a user limited to districts, that is with no
  other right than `division-officer`; null for everyone else: COEP, Head Officer, Super Admins, view-only, and division-officer together with one
  of those.
- With more than one level, `SENT_ON` / `SENT_BACK` look at the levels that cover that application: for a Divisional Officer who is also COEP, a form
  of another district sent back to DIVISION is `SENT_BACK`. Without a level both are empty. A correction (`CORRECTED`) moves nothing: a form sent
  back stays `SENT_BACK`, and `lastEvent` still says why; `history` has every event.
- `sortOrder` is `ASC` / `DESC` (default `DESC`), as in every list of this API.
- The permission catalogue has the menus `ipp-approvals` and `ipp-officers`; the codes used are `ipp-approvals.view`, `.division-officer`, `.coep`,
  `.head-office`, `ipp-officers.view`, `ipp-officers.update`.
- A user who holds SUPER_ADMIN or SUMAGO_SUPER_ADMIN next to an officer's role is a Super Admin: not listed as an officer, and districts assigned to
  them count as without officer.
- `POST /batches/:id/approve` never skips (`skipped: 0`): it takes only what is mine. `POST /approve` and it accept `Idempotency-Key`; the single
  decisions do not (their answer is the whole form), a second one finds another stage.
- A reason loses control characters and is trimmed before it is counted.

**Messages of IPP**
- District of the batch, among the active districts (of the state, when Sarthi has a state with IPP's `state_code`): by code (any case, with or without
  the state in front: `PUN` = `MH-PUN`), else by name, else by a known other spelling (former and Marathi names). No match, more than one, or a code
  that means one district and a name that plainly means another → 409 `DISTRICT_UNKNOWN`: a batch never goes to the officers of a guessed district.
- An application that is in another batch → 409 `APPLICATION_IN_OTHER_BATCH` for every action.
- An older `seq` changes neither the form nor the batch and leaves no event; an older `RESUBMIT` still brings the form back to DIVISION.
- The headers are checked before the body is read, and the signature over the raw bytes before they are parsed. Of a malformed message the first 20
  places are named, never a value. Only a masked Aadhaar number is accepted (and stored as `XXXX-XXXX-1234`; the database refuses any other form).
- A batch has Sarthi's own id; IPP's is kept in `ipp_batches."ippId"`. An application has IPP's id.

**Decisions to IPP** (`src/modules/ipp-approvals/ipp-outbox.*`)
- Sent at once after the commit, and every `IPP_LINK_INTERVAL_SECONDS` for what has to be tried again; a PostgreSQL advisory lock keeps one sender at a
  time. At most one decision per application and call, so a later one never overtakes one IPP refused; a FAILED decision holds back the later ones
  of the same application until Retry.
- 400, 413 or 422 for a call of several: each is sent on its own, so one bad decision does not fail the others.
- Retry starts the waiting times again; `ids: []` retries none. `lastError` holds statuses, codes and stages only.

**Documents**: PDF, JPEG, PNG and MP4 of at most 60 MB; another type, a larger file, and any answer of IPP but 200 and 404 → 502 `IPP_UNAVAILABLE`.
A file that stops coming for `IPP_HTTP_TIMEOUT_MS` is cut. Every file passed on is audited (`ipp.document.view`: who, which form, which code).

**Audit** (no personal data): `ipp.application.approve`, `ipp.application.approve-many`, `ipp.batch.approve`, `ipp.application.reject`,
`ipp.document.view`, `ipp.head-office.update`, `ipp.officer.districts`, `ipp.link.retry`. IPP's messages are in `ipp_messages` and the history.

## Settings and deployment

`IPP_LINK_ENABLED`, `IPP_API_URL` (with path, e.g. `https://ippapi.sumago.ai/api/v1`), `IPP_LINK_SECRET` (≥ 32 characters, the same as in IPP),
`IPP_HTTP_TIMEOUT_MS`, `IPP_LINK_INTERVAL_SECONDS`; see `.env.example`. On without a URL or with a short secret the API does not start.

1. `npm run migration:run` (or `:prod`) and `npm run seed` (permissions and the roles Divisional Officer, COEP, Head Officer).
2. The reverse proxy must let `/integration/v1/ipp/` through to the API unchanged (path and query are signed) with bodies of up to 5 MB
   (nginx: `client_max_body_size`, 1 MB by default). IPP's calls count in the general rate limit (`RATE_LIMIT_MAX` per IP).
3. Give the officers their roles and, on the page IPP Officers, the Divisional Officers their districts.
