# G-2: "Show live LMS data" setting (off = current behaviour)

User decision (21 Nov 2026): a setting decides whether the Panel's LMS screens show live data from the LMS or the
local (dummy) data they show today. Off must leave the current behaviour unaffected.

User rule (21 Nov 2026): **Amrut's `lms_*` tables are kept permanently** — never dropped, renamed or emptied. The
setting only chooses which source the screens show; the local tables, routes and screens stay as the other source.
This change creates one new table (`panel_settings`) and does not touch any `lms_*` table.

## Two switches

| Switch | Where | Default | Who | Effect |
| --- | --- | --- | --- | --- |
| `LMS_READS_ENABLED` | server env (master switch) | `false` | whoever runs the server | Off: live reads are impossible, whatever the setting says. The `/api/v1/lms-reads` data routes answer exactly as in M1 (`404 LMS_READS_DISABLED`). |
| **Show live LMS data** (`panel_settings` key `lms.live_data`) | database, System Settings screen | off (no row) | `settings.update` (read: `settings.view` or any LMS screen right) | On (and master switch on, LMS link configured): the LMS screens read live. Off: the screens show local data as before. |

The screens are live only when **setting on AND master switch on AND LMS link configured** (`LMS_EXTERNAL_BASE_URL`,
`LMS_TENANT_API_KEY`, `LMS_TENANT_CODE` entered; none of them is preset). The switch can be turned **on** only while the
master switch is on and the link is configured; otherwise it is disabled on the screen with the reason, and the API
answers `409 LMS_LIVE_DATA_UNAVAILABLE` with `details` `blocker` (`MASTER_SWITCH_OFF` / `LMS_NOT_CONFIGURED`) and the
names of missing variables (never values). Turning it **off** is always allowed. If the master switch is turned off later
while the setting is on, the screens go back to local data (the state says `setting: true, live: false`).

Every change is written to `audit_logs` in the same transaction: action `lms.live_data.update`, resource
`panel_setting`, resourceId `lms.live_data`, details `{ from, to }`. Re-sending the current value changes and audits nothing.

## API (`/api/v1/lms-reads`)

| Route | Right | |
| --- | --- | --- |
| `GET /live-data` | any LMS screen `.view` code, `lms.view`, `settings.view`, `settings.update` | `{ setting, masterSwitch, configured, canEnable, blocker, missing, live, source: 'live'\|'local', updatedAt, updatedByUserId }` |
| `PUT /live-data` `{ enabled: boolean }` | `settings.update` | Returns the new state. 409 as above; 422 on another body. |
| data routes (`/summary`, `/centres`, `/batches`, `/sessions`, `/live-sessions`, `/trainers`, `/attendance`) | as M1 | Master switch off → unchanged M1 `404 LMS_READS_DISABLED`. Master on + setting off → `404 LMS_LIVE_DATA_OFF`, no LMS call. Both on → live data in the M1 shapes, plus envelope fields `source: 'live'` and `fetched_at` (same instant as header `X-Lms-Fetched-At`). |

LMS unreachable while on: the M1 errors (`503 LMS_TIMEOUT` / `LMS_UNREACHABLE` / `LMS_UNAVAILABLE` / `LMS_RATE_LIMITED`
/ `LMS_KEY_REJECTED` / `LMS_BAD_ANSWER`). The API never falls back to local data and never mixes sources in one answer;
the screens show an error state with a Retry. `GET /status` (M1 probe) is unchanged. Switching on clears the read cache.

Storage: table `panel_settings (key PK, value jsonb, updatedByUserId, createdAt, updatedAt)`, migration
`1798700000000-PanelSettings` (no row inserted: absence = off).

## Screens (sarthi-admin, module `src/modules/lms-live`)

Each covered screen shows a badge: **Local data**, or **Live from LMS** with the time of the live fetch.

| Screen | Off | On (live read) |
| --- | --- | --- |
| Batches | current page, unchanged | `/batches` |
| Training Centres | current page, unchanged | `/centres` |
| Trainers | current page, unchanged | `/trainers` |
| Live Training Monitor | current page, unchanged | `/live-sessions` (today; needs API-110 on the LMS, else `LMS_NOT_FOUND` error state) |
| Offline Training / Online Training | current pages, unchanged | `/sessions`, filtered by delivery mode in the Panel (the LMS has no mode filter yet) |
| Attendance | current page, unchanged | `/attendance` with a group-by select |
| System Settings | new card "Show live LMS data / LMS चा थेट डेटा दाखवा" with en + mr help text | |

How the off path stays unchanged: each page's existing component is kept as it was (renamed `Local…Page`) and a
wrapper picks the source. While the state is first loaded the screen shows "Loading…" (never one source then the other).
Any error of the state call (old server without G-2, 403, network) means local. Live views read one page (100 rows)
and say "Showing the first N of M" when the LMS has more.

Safe steps followed: (a) setting + switch with the off path untouched; (b) Batches live behind it; (c) the other screens.

## Tests

- API `tests/integration/lms-reads/live-data-setting.test.ts`: off-path contract snapshots (exact M1 `LMS_READS_DISABLED`
  bodies, unchanged `/status`), master on + setting off, switching on refused (master off / link incomplete), rights,
  body validation, on path with the LMS faked (`source`, `fetched_at`, shapes, audit row), LMS down while on (503, no
  `source`, no data), master switch off later, switching off. `lms-reads.routes.test.ts` (M1) runs with the setting on.
- Admin `tests/g2-live-data.test.tsx`: every screen off (local badge, local page, no live read) and on (live badge with
  time, only live rows), old server → local, LMS error → error state + Retry and no local data, settings switch
  (en + mr, disabled with reason, read-only without `settings.update`, server refusal shown). `tests/api-client.test.ts`:
  `source` / `fetched_at` passed on.

## Kept permanently, and screens left for later

- Not switched yet: Dashboard KPIs, Executive, Today (`/summary`; Dashboard already mixes live student figures with
  mock ones and needs its own design), Trainer ToT, batch / trainer / centre detail pages, Progress, Lifecycle,
  Assessments, Certification (LMS reads not built or not in M1).
- Kept permanently (user rule, 21 Nov 2026): the `lms_*` tables, the `/api/v1/lms/*` masters and their screens, and
  the admin local data (`src/services/mock/*`, `src/legacy`) that the off path uses. They are the "local" source the
  setting switches back to; no step of G-2 or later drops, renames or empties them. The table-by-table comparison in
  [lms-reads/g2-lms-tables-mapping.md](lms-reads/g2-lms-tables-mapping.md) is reference only.
