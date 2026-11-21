# M3 — Attendance reports by division and district

Approved 21 Nov 2026. The Amrut Panel shows attendance by **division → district → centre → batch**, read live from the
LMS. Nothing is stored in Amrut's database; there is no migration and no new permission code.

## Source

`GET /tenant/v1/attendance` on the LMS (MT-A14, scope `delivery.read`), through the M1 read client
(`src/modules/lms-reads`): same `LMS_EXTERNAL_BASE_URL` / `LMS_TENANT_API_KEY`, same switch `LMS_READS_ENABLED`, same
timeout and short cache (`LMS_READS_TIMEOUT_MS`, `LMS_READS_CACHE_SECONDS`, default 30 s; identical reads share one
call). Batch level also reads `GET /tenant/v1/batches` (scope `stats.read`) to place each batch under its centre.

The LMS answers codes and counts only: `{group_by, date_from, date_to, items: [{code, batches, sessions_held, present,
late, absent, excused, self_check_ins, geo_check_ins, selfies, group_photos}]}`. No names, learners, pictures or
locations reach Amrut.

## Endpoints (`src/modules/attendance-reports`)

| Method | Path | Answer |
| --- | --- | --- |
| GET | `/api/v1/attendance-reports/status` | `{enabled, configured, liveData, live, cacheSeconds, timeoutMs}` — `liveData` is the setting "Show live LMS data", `live` = all three on; never calls the LMS, never returns the key or URL |
| GET | `/api/v1/attendance-reports` | the report (below) |

Query: `level` = `division` (default) \| `district` \| `centre` \| `batch`; `dateFrom`, `dateTo` (YYYY-MM-DD, LMS
default the last 30 days, at most 366 days — longer ranges are refused with 422 before any LMS call); drill-down filters
`division` (LMS division code, e.g. `PUNE`), `district` (Amrut District Master code), `centre` (Training Centre code);
optional `entityCode`.

Answer: `level`, `dateFrom`, `dateTo` (as the LMS applied them), `fetchedAt`, `filters` (the filter places with names),
`rows[]`, `totals`, `unplaced`. Each row: `code`, `name`, `nameMr`, `mapped`, its `division` / `district` / `centre`
(`{code, name, nameMr}` or null), the counts, `marked` (= present + late + absent + excused) and `presentPercent`,
`latePercent`, `absentPercent`, `excusedPercent`, `attendancePercent` (= present + late), each a share of `marked` with
one decimal, null when nothing was marked. Totals are summed counts with percentages taken from the sums (not an average
of row percentages). Headers `X-Lms-Fetched-At`, `X-Lms-Cache` (HIT / MISS / REVALIDATED) as on `/lms-reads`.

Permissions (any one): `attendance.view`, `reports.view`, `lms.view`. The Panel shows CSV export only with
`reports.export` (the CSV is built in the browser from the rows on screen).

## Code → name mapping

- **District**: the LMS groups by the centre's district code — the Amrut District Master code it pulled through
  `/integration/v1/reference` — or, when a centre has none, a key made from the district name (`AHILYANAGAR`), or
  `NOT_SET`. Amrut matches the code to its District Master first, then by the same name key.
- **Division**: Amrut's District Master has no division column. `MAHARASHTRA_DIVISIONS`
  (`attendance-reports.constants.ts`) holds the 6 divisions and 36 districts with the same codes, keys and aliases as the
  LMS's platform rows of `district_division` (lms-api migration 20260101026000, AT-10), plus Marathi names. An Amrut
  district is placed by its name key, an alias (e.g. Ahmednagar → Ahilyanagar, Aurangabad → Chhatrapati Sambhajinagar)
  or its code. The LMS's `NOT_MAPPED` division is shown as "Not mapped".
- **Centre**: LMS centre code = Amrut Training Centre code; name and district from Amrut's master.
- **Batch**: LMS batch code; its centre from the LMS batch list (up to 50 pages × 100).
- A code Amrut's masters do not know is still shown, under its LMS code, with `mapped: false` (sorted last). When a
  drill-down filter applies and a row's parent is unknown, the row cannot be placed: it is left out of rows and totals
  and counted in `unplaced`, which the screen reports.

## When there is no data

| Situation | API | Screen |
| --- | --- | --- |
| LMS reads off (`LMS_READS_ENABLED=false`) | 404 `LMS_READS_DISABLED`; status `enabled:false` | "Live LMS data is switched off" |
| G-2 setting "Show live LMS data" off (master switch on) | 404 `LMS_LIVE_DATA_OFF`; status `liveData:false` | same |
| LMS link not configured | 503 `LMS_NOT_CONFIGURED`; status `configured:false` | "The LMS link is not configured" |
| LMS down / slow / key refused / rate limited | 503 `LMS_UNAVAILABLE` / `LMS_TIMEOUT` / `LMS_UNREACHABLE` / `LMS_KEY_REJECTED` / `LMS_RATE_LIMITED` | "The LMS cannot be reached right now" with the code and Try again |
| No attendance in range | 200, `rows: []` | "No attendance in this range" |

The screen never shows dummy or cached-in-browser figures in these cases. The key never appears in an answer or log.

## Area scoping

Panel users carry no district or division assignment today (the `users` table has none; "District Coordinator" is a
role name only), so every permitted user sees the whole of Amrut. When an assignment is added, the report service is the
place to apply it: intersect the request's `division` / `district` with the user's area before `buildReport`, and
refuse a filter outside it.

## G-2 "Show live LMS data"

The report follows the same two switches as the other LMS screens (`/lms-reads` liveDataGate): the master switch
`LMS_READS_ENABLED` first (off → 404 `LMS_READS_DISABLED`, whatever the setting), then the Panel setting (off → 404
`LMS_LIVE_DATA_OFF`). The check sits in `AttendanceReportsService.report` (`liveDataSettingService.isOn()`), before any
LMS call or master read, so no figures leave the server while live data is off.

## Tests

- `tests/unit/attendance-reports/` — mapping (codes, name keys, aliases, NOT_SET / NOT_MAPPED), percentages and totals,
  filters and `unplaced`, batch paging, query limits, errors passed through.
- `tests/integration/attendance-reports/` — routes with the LMS faked (`tests/helpers/fake-lms-reads.ts`, now with
  per-`group_by` items) and synthetic masters: every level, cache HIT, 422 range, switch off, not configured, LMS down /
  unreachable / timeout / key rejected, key never in the answer, permissions.
